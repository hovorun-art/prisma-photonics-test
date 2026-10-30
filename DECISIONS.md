# Design Decisions

<!-- Draft: filled in as decisions are made; the final structure follows the task's template. -->

## 0. Stack and Architecture

**NestJS (API and worker).** The API and worker are two apps sharing modules (job types, database
access, queue adapter). Dependency injection lets tests swap the clock, randomness and the queue
for fakes. Nest has first-party BullMQ and Swagger integrations. Note: `@nestjs/microservices` only
provides message transports (Redis, RabbitMQ, Kafka); it has no retries, delays or priority, so it
does not replace a job queue. *Trade-off:* more boilerplate than Fastify or Express, and decorators
need an SWC build step to work with Vitest.

**React + Vite (web).** The UI is a dashboard behind an API, so server-side rendering adds nothing.
A static SPA in its own container is the simplest to build and deploy. *Trade-off:* none significant
for this scope.

**REST + OpenAPI instead of tRPC.** tRPC would give end-to-end types between the API and our UI
for free, but it couples clients to TypeScript and to our router. A job queue service is
infrastructure that other services (in any language) should be able to call, so we expose a plain
REST API described by OpenAPI (Swagger). *Trade-off:* request/response types for the UI must be
shared through a workspace package or generated from the OpenAPI spec instead of being inferred
automatically.

**Postgres (state) + Redis (queue).** Postgres is the source of truth for job state, results, logs
and idempotency keys: durable, queryable, with constraints and transactions. Redis holds the queue.
*Trade-off:* two stores to keep consistent; how we do that is described in the sections below.

**BullMQ behind our own queue interface.** The task allows any queue technology. Our goal was a
running system first, so we use BullMQ for the low-level mechanics: atomic pickup, stalled-job
detection, priority, delays and backoff. It sits behind a small interface of our own (enqueue,
claim, complete, fail, cancel), so the API and job handlers do not depend on it, and its internals
can later be replaced with hand-written Redis logic. What we still own: keeping Postgres in sync with
the queue, the status lifecycle, idempotency, races (cancel vs pickup, retry vs a running worker),
reconciling state after crash recovery, and the job log.
*Trade-off:* BullMQ hides the lowest-level concurrency logic. We gained speed and reliability and
gave up writing that logic ourselves. Each section below says which part is BullMQ's and which is
ours.

**Alternatives considered.**
- *Custom Redis queue* (sorted sets + Lua): shows the most low-level logic, but is the slowest
  option and the most likely to have bugs. It is a possible later step behind the same interface.
- *RabbitMQ*: acks and redelivery built in, and priority queues work, but delayed jobs need a
  plugin or TTL/dead-letter tricks, queue stats are harder to get, and it adds a heavier service.
- *Postgres-only queue* (`FOR UPDATE SKIP LOCKED`): one store and no dual-write problem, but
  polling load on the database and less separation between state and queue.
- *Kafka*: a log, not a job queue. No per-message priority, delays or per-job acks; operational
  overhead far beyond this task.

**Health checks report only the service itself.** `GET /health` on job-service and on
job-execution-service answers 200 `{ "status": "ok" }` while the process runs. It does not probe
Postgres, Redis or the other service. If health checks included related services, services that
wait for each other's health (compose `depends_on: service_healthy`, orchestrator readiness) could
form a circular dependency: A waits for B to be healthy, B reports unhealthy because A is not up,
and nothing ever becomes healthy. A failing dependency also would get the healthy service restarted,
which does not fix the dependency. *Trade-off:* `/health` does not tell an operator that Postgres or
Redis is down; that shows up as errors and logs on the requests that need them. An earlier version
probed dependencies and listed live execution instances through heartbeats; we removed it as more
complexity than this stage needs.

**Job state has one owner: job-service.** Only job-service has database access.
job-execution-service will read and change job state only through job-service's `/internal` API,
never by writing the jobs table. Two services sharing one table is the shared-database
anti-pattern: a schema change breaks both, and the Job entity's rules can be bypassed. Clients get a
narrow external update (cancel from pending/scheduled, retry from failed); the system's own changes
(status, attempts, errors, results, logs) go through a separate internal update method.
*Trade-off:* field-level internal attributes (as in gRPC services with per-field permissions) would
express this more precisely; a second method is simpler and enough here. Every state change costs
an HTTP hop from the execution service; timeouts and retries for it are designed with the first job
flow.

**Calls from the worker to job-service: a timeout, then retries with p-retry.** In
job-execution-service the port to job-service is `JobRepository` (`HttpJobRepository` over the
internal API): to the worker it is simply where jobs are read and saved. A call that cannot reach
job-service (network error, timeout or 5xx) is retried a configured number of times (3). The wait
starts at a configured delay (500 ms), doubles each time up to a configured maximum (5 s), and is
randomized (1–2×) so workers that lost job-service together do not hammer it together when it
comes back. A 404 or 409 is an answer, never retried. Shutdown aborts a wait through the library's
`AbortSignal`. *Why a library:* a hand-written loop was replaced; retry timing is generic plumbing,
and we choose such libraries from usage data. Candidates (npm weekly downloads, latest release):
`retry` 158.5M (0.13.1, 2021), **p-retry 71.6M (8.0.1, 2026-09)**, exponential-backoff 55.0M
(3.1.3, 2025-10), async-retry 48.3M (1.3.3, 2021), promise-retry 36.1M (2.0.1, 2020), cockatiel
2.9M (4.0.0, 2026-05), backoff 1.4M (2.5.0, 2016). p-retry is the most used maintained one, ships
its own types as ESM, and is the only widely used one that takes an `AbortSignal`, which the
shutdown needs. *Trade-off:* its jitter is a 1–2× factor, not "full" jitter, which spreads load
slightly less; cockatiel would add a circuit breaker, but nothing needs one yet.

**Five operations per feature, lifecycle rules inside `update`.** The job API, `JobService` and
`JobRepository` each have exactly create, get, query, update and delete. Starting, completing and
failing a job are not methods of their own: job-execution-service sends one internal `PATCH` with
the target status, and `JobService.update` decides the next state from the stored job (start only
from pending and count the attempt; complete only from processing and check the result against the
job type; fail only from processing, then retry or fail for good). *Why:* a small, uniform surface
that maps one to one onto REST and onto a later remote service. *Trade-off:* `update` is one method
with a branch per status instead of named methods; the request body (a union keyed by status) is
what names the step.

**Concurrent state changes: compare-and-set in Postgres.** `JobRepository.update` writes only while
the job's status and attempts still equal what `JobService` read (`UPDATE ... WHERE id = $1 AND
status = $2 AND attempts = $3`); `delete` only while the status is a finished one. When two workers
report a start for the same job at the same time, Postgres' row lock lets one `UPDATE` match and the
other match nothing, which becomes 409 `JOB_STATUS_CONFLICT`. Attempts are part of the condition
because a job can go processing → pending → processing (another worker took the retry) between a
read and a write; status alone would not notice. *Trade-off:* every report reads before it writes
(one extra query), which `update` needs anyway to validate the result and decide on a retry.

**Retry rule owned by job-service; an attempt is counted on start.** The worker only reports
`failed` with an error. job-service sends the job back to pending (and queues the next attempt)
while attempts are below max attempts, otherwise it fails the job for good. Counting on start means
a worker that crashes mid-job still uses up an attempt, so a job that kills its worker cannot loop
forever. In job-api the retry is immediate; backoff delays come with the retry-backoff change.

**Queue entries carry only the job id, one entry per attempt.** job-service puts
`{ jobId }` on the BullMQ queue under the entry id `<jobId>_<attempt>`; the worker reads the job
from job-service, so Postgres stays the only copy of job data and a deleted or changed job is seen
at once. BullMQ ignores an `add` with an id it already has, so the same attempt is never queued
twice, while a retry (the next attempt) gets its own entry. (`:` would read better, but BullMQ
rejects it in custom ids.) Ids themselves come from Postgres (`gen_random_uuid()`).

**Enqueue failure leaves the job pending, not the request failed.** A job is stored first, then
queued. If Redis is down or slower than the configured timeout, the submit (or the retry report)
still succeeds, the job stays pending and a warning with the job id is logged. The crash-recovery
change adds a sweep that re-queues pending jobs that have no queue entry; until then such a job
waits. *Alternatives:* deleting the row and answering 503 (simple, but the client must resubmit and
may not); a transactional outbox (a row in the same transaction, relayed to Redis until it
succeeds), which is the robust answer and the one we would take with more time. *Trade-off:* a
window in which a job is pending but not queued.

**Query: offset pages over indexed columns.** `GET /v1/jobs?limit&offset` returns newest first,
ordered by `(created_at DESC, id DESC)` so jobs created in the same millisecond keep a stable order
across pages. Indexes: `(created_at DESC, id DESC)` for this order, `(status, created_at DESC)` for
status filters and the pending-job sweep, `(type, created_at DESC)` for type filters. Default and
maximum page size are configuration; a larger `limit` is a 400, not silently clamped.
*Trade-off:* offset paging gets slower on deep pages and can repeat or skip rows while jobs are
being inserted; keyset (cursor) paging fixes both but makes a numbered table in the UI harder.

**Query filters: repeated parameters, `total` over the matches.** `GET /v1/jobs` filters by
`status` and `type`; several values repeat the parameter (`?status=failed&status=cancelled`), the
form OpenAPI describes for query arrays and `URLSearchParams` builds. The two filters combine with
AND, the values of one with OR, and `total` counts the matching jobs, so paging works over the
filtered list. An unknown or empty value is a 400 naming the field rather than an empty page, so a
typo is visible. The shared Zod schema turns one value or several into a list without duplicates,
and the generated docs list the allowed values. *Alternatives:* comma-separated values (custom
parsing, weaker docs); an empty page for unknown values (hides client bugs). *Trade-off:* the
existing indexes serve one value per filter well; several values or both filters together read
the matches and sort them, and `COUNT` reads every match. Fine at this task's volume; no new index
was added, the demo seed's volume mode measures it, and sort order and cursor paging are planned
as optional polish changes that will redesign the indexes around the sort key.

**Limits in the shared contract, page sizes in config.** Priority and max-attempts ranges and
defaults and the email field lengths are constants in the shared Zod schemas, so the API and the
UI form validate with the same rules. Values that operators tune (page sizes, enqueue timeout) are
environment config of job-service.

**job-ui: polling, not push.** The jobs list and the job page fetch again every 2 s (TanStack
Query `refetchInterval`); a failed poll keeps the last data on screen with a "Connection lost,
retrying" note, and polling itself is the retry. *Alternatives:* Server-Sent Events or WebSockets
push changes at once and cost less per idle tab, but need a change feed from job-service (Postgres
`LISTEN/NOTIFY` or queue events) and reconnect handling. *Trade-off:* up to one interval of delay
and one request per open page per interval; SSE is the planned upgrade if time allows.

**job-ui: the whole design laid out now, unbuilt parts disabled.** Filters, search, Cancel/Retry,
queue statistics, the health pill, scheduling and idempotency fields are in place but disabled with
a "Coming soon" tooltip; each later change enables its part. *Why:* reviewers see the target UI,
and later changes only wire behaviour. *Trade-off:* visible controls that do nothing yet.

**job-ui: the form validates with the API's own schema.** The submit form uses `react-hook-form`
with `zodResolver` on the shared `CreateEmailJobRequest` Zod schema before sending (chosen over
`@tanstack/react-form` for its reach: ~62M against ~6M weekly downloads), and maps an API `VALIDATION_FAILED` answer to
the same fields, so client and server rules cannot drift. Messages shown for client-side errors
come from the locale file, not from Zod. The `VALIDATION_FAILED` issues are read through a shared
`ValidationFailedDetails` schema; an issue that matches no field is shown in the form's alert
rather than dropped.

**job-ui: one form shell, one payload section per job type.** The submit page renders the form of
the chosen type (`/jobs/new?type=webhook`, so the link can be shared and Back works); each type
supplies its fields, starting values, form schema, messages and request preview, and the shell owns
execution settings, submit and API error mapping. A type switch starts a fresh form and carries
Priority and Max attempts over. *Alternatives:* one form over the union of all types (awkward
typing and per-type validation in `react-hook-form`), or a page per type (repeats the shell).
*Trade-off:* a small generic layer, which pays off as transit and batch are added.

**job-ui: a webhook body is typed as text.** The "Body (JSON)" field holds what the user typed; the
form schema treats blank text as "no body" and otherwise parses it and checks it with the
contract's `JsonObject`, so invalid JSON and non-objects are caught under the field before
anything is sent. *Alternative:* a structured key/value editor, which cannot express nested JSON
without much more UI. *Trade-off:* the preview shows the raw text while it is not valid JSON.

**job-ui: errors are contained per page with `react-error-boundary`.** Each page sits in an error
boundary inside the app frame, so an unexpected error, or a failed first load of the list or a job,
replaces only that page with "Something went wrong" and a Reload button; the header keeps working.
TanStack Query's `QueryErrorResetBoundary` makes Reload load the failed data again. *Alternatives:*
react-router's `errorElement` (only in its data-router mode, which the app does not use) or a
hand-written class component. *Why this library:* v6, ~20M weekly downloads, typed, React 19
support, and the pattern TanStack Query documents. *Trade-off:* one more dependency.

**Internal API protected by a shared service token.** Routes under `/internal` require
`Authorization: Bearer <token>` (compared in constant time) and are left out of the public Swagger
docs. *Trade-off:* a shared secret in environment variables is weaker than service identity (mTLS,
or gRPC with per-service credentials), but needs no certificate setup. It is replaceable behind the
guard.
The token is checked twice: by an Express middleware for every `/internal` path, which runs before
the body parsers, and by the controllers' guard. Without the middleware a call with no token but a
malformed or oversized body was answered 400 or 413, which tells an unauthenticated caller how the
body is parsed; now it is 401 like any other call without the token. *Trade-off:* two places apply
the same check (both go through one `InternalAccess` port, so the rule itself is written once).

**Unreadable request bodies: 415 or 400, never 500.** A body in an encoding or charset the body
parser does not support is answered 415 `UNSUPPORTED_MEDIA_TYPE`; a body that declares a supported
encoding (e.g. `br`) but cannot be decompressed is malformed and is answered 400
`VALIDATION_FAILED`, like invalid JSON. Before, both reached the error filter as unknown errors and
were answered 500. *Why:* a 500 says the server failed, so clients and alerts would treat a client
mistake as an outage.

**Contracts through shared Zod schemas, not Pact.** Every request, response and error body is a
Zod schema in `packages/contracts`, used by the server for validation and OpenAPI and by the tests
to validate stubs and fixtures. In one repository this catches contract drift at compile and test
time. *Trade-off:* no consumer-driven contract tests; if the services were split into separate
repositories, Pact (or published schemas) would be the next step.

**Code structure: layers first, an interface for every class.** Each app has `domain/` (interfaces
and types only), `infra/` (every implementation) and `app/` (NestJS entry points and wiring).
Every class implements an interface; constructors take a deps object and, when configured, a
params object; every method with inputs takes one request object and returns one response object.
Logic shared between the services lives once: framework-free in `packages/kernel` (graceful
shutdown, fatal-error handling), NestJS-bound in `packages/service-kit` (bootstrap, base config,
logging, Redis, health). ESLint enforces the layers and the class shapes. *Why:* any feature or
domain module can later move into its own service without rewrites, and named request/response
objects keep signatures stable as fields are added. *Trade-off:* noticeably more boilerplate
(request/response types, interfaces with a single implementation, factory wiring in modules) than
idiomatic NestJS.

**Tests: each case once, at the lowest level that can see it.** Schema rules (limits, types,
`null`, every edge of a range) are tested in the contract schemas' unit tests; one class's logic
(state rules, retry arithmetic) in its unit test; an adapter against its real dependency
(Testcontainers) in its integration test. The per-app e2e tests check each spec scenario once
through HTTP, plus what only the running app can show: races between two callers, the order of
middleware (token before body), body limits and a retry cycle through the routes. In job-service
they run the real `AppModule` with the bootstrap's own setup steps on a migrated Postgres
Testcontainer, and mock the services around it at our ports (the job queue and the Redis
connection) with `mockDeep`. A queue outage is a stub that rejects once, not a second app pointed at
a dead address. job-execution-service's e2e tests run its `AppModule` the same way, without a
database: queue entries are handed in through the callback the app registers with the mocked queue
consumer, and job-service's internal API, Redis, the sleeper and randomness are mocked, so handler
times, failure draws and the shutdown grace period run without waiting. Their log lines (instance id
on every line) are collected through a log destination that `LoggingModule` accepts for this. The
tests are split into files by spec area, sharing one small setup class instead
of a folder of launchers, fixtures and probe controllers. A separate reviewer agent
(`test-case-reviewer`) checks each test area for missing corner cases and for duplicates of lower
levels. *Trade-offs:* job-service's shutdown is tested in the test process (`app.close()` closes
the database, the queue and Redis once); no test sends SIGTERM to a real job-service process or
checks its exit code, so the signal wiring is covered only by service-kit's unit tests; the same
holds for job-execution-service, whose "takes no new entries, waits for running ones" is the mocked
consumer's behaviour here and is shown for real by the consumer's integration test and the system
e2e. Nest's logger is process-wide, so all apps started in one e2e file write to one list of log
lines, and the start log line is checked in the bootstrap's unit test, not by the e2e. Jobs in
states no route can create are seeded through the app's own repository, so a mapping bug there would
affect the seeded data and the read-back alike (the repository's integration test guards the
mapping). Each e2e file starts its own Postgres container, which costs a few seconds per file and
loads Docker when all suites run at once.

**One large commit for the scaffold, small commits after it.** The task asks for small, clean
commits, and the feature work follows that. The project scaffold (workspaces, tooling, shared
packages, both services, Docker, CI, test levels) is deliberately one commit. While the
infrastructure was being set up and the AI workflow tuned (code rules, layer and class lint rules,
test levels, agent instructions), the same files were rewritten several times: the module layout
moved to layers first, health went from dependency probes and heartbeats to a plain 200, and
duplicated code moved into shared packages. Committing each intermediate state would have recorded
mostly churn that the next step overwrote. *Trade-off:* the scaffold's history is not reviewable
step by step; the reasoning behind each turn is kept instead in this file, in the OpenSpec change
(`openspec/changes/project-scaffold/`: decisions, design and tasks) and in the AI chat logs.

**One error shape for every job type (webhook failures).** The UI design shows a failed webhook's
error as `{ code, message, status, attempt, retryable }`. We keep the shared
`JobError { code, message, details }` instead: the HTTP status of the failed call goes into
`details.statusCode`, the attempt number is the job's `attempts`, and "retryable" is
`attempts < maxAttempts`, so the UI derives both from fields every job already has. *Why:* one
error schema for all job types, and no second copy of state the job already holds. *Trade-off:*
`details` is untyped per job type, so the UI must read `details.statusCode` defensively. The webhook
type was added to job-service one change before its handler in job-execution-service
(`webhook-job-execution`), so for one commit a queued webhook job failed as `UNSUPPORTED_JOB_TYPE`.

**Simulated webhook calls.** A webhook job never calls its URL. The handler waits a fixed
configured time (`WEBHOOK_CALL_MS`, 1500 ms), then fails the attempt at the configured rate
(`WEBHOOK_FAILURE_RATE`, 0.2) with a random 500, 502, 503 or 504, or answers 200 with
`{ received: true, requestId }`. The failure is drawn after the wait, so a failed call costs as much
time as a real one; the wait and the draw come through the `Sleeper` and `Random` ports, so tests
set the outcome. *Why:* the concept asks for a simulated webhook with random failures to exercise
retries; a fixed wait keeps the processing state easy to watch. *Trade-off:* with the default rate
and 3 attempts about 0.8% of webhook jobs fail for good, which is the point; set the rate to 0 for
demos that need every job to succeed.

**Handlers return expected failures instead of throwing them.** A `JobHandler` returns
`{ outcome: 'completed', result }` or `{ outcome: 'failed', error }`, and the worker reports the
error as is, `details` included. Thrown errors stay for the unexpected (`DomainError` code, or
`HANDLER_ERROR`). *Why not a `DomainError` with a new code:* `ERROR_CODES` is the closed list of API
errors, each mapped to an HTTP status by the exception filter; `WEBHOOK_HTTP_ERROR` is data about a
job attempt, not an answer of our API, so it lives with the job failure codes of job-execution-service
(`WEBHOOK_JOB_ERROR_CODES` next to `JOB_ERROR_CODES`). *Trade-off:* two failure paths in the worker,
one for returned and one for thrown failures; both end in the same `failed` report.

**Flight transit: a bundled airport list in the contracts.** A transit job names two airports from
a static list of 56 major hubs on every inhabited continent (`AIRPORTS` in `packages/contracts`,
with IATA code, name, city, country, coordinates and IANA time zone). The payload schema accepts
only those codes (`z.enum`), so `lhr`, `LH` and `XXX` all answer 400 on the field, and OpenAPI
lists the allowed codes. *Why:* the task forbids an external API, and one typed constant serves
job-service's validation, the later report generator and the UI's airport pickers alike. *Why not a
JSON file loaded at runtime:* it would need a loader in the browser and would lose the literal
union of codes. *Trade-off:* adding an airport means a release of the contracts, and a 56-value
enum makes the OpenAPI document and the error message long.

**Flight transit: the departure-day rule runs in job-service, in UTC.** A transit job is accepted
while its `departureDate` (UTC) is not over at job-service's time: today passes, yesterday answers
400 on `payload.departureDate`. The shared schema only checks the form (`YYYY-MM-DD`, a real
calendar date); `JobServiceImpl.create` checks the day against the injected `Clock` and throws
`InvalidJobPayloadError` (`VALIDATION_FAILED`, so the API answer looks like any schema failure).
*Why not a Zod refine reading the time:* the contracts are shared by the browser and stay free of
time, and a schema that reads `new Date()` cannot be tested deterministically. *Trade-off:* a client
late in its local evening may already be on the next UTC day (or still on the previous one), so
"today" is UTC's, not the user's.

**Flight transit: job-service checks the report's shape, not its content.** A completed transit
job's report must match `FlightTransitJobResult` (coordinates in range, no negative numbers, at
least two path points and two waypoints), but job-service does not check that it names the
payload's airports or date. *Why:* as for webhook, job-service owns state and shape; the worker owns
the content it generates. *Trade-off:* a buggy generator could store a report for the wrong route;
its own tests guard that. The type was added one change before its handler
(`flight-transit-job-execution`), so for those commits a queued transit job failed as
`UNSUPPORTED_JOB_TYPE` after its attempts. Postgres
stores the type as `flight-transit`; Prisma names the enum value `flight_transit` (no `-` allowed),
so the repository maps between the two.

**Flight transit: a made-up flight on the real great circle.** job-execution-service generates the
report from the bundled airports alone. The distance is the great-circle distance on a 6371 km
sphere; the path is the configured number of evenly spaced points on that great circle
(`FLIGHT_TRANSIT_PATH_POINTS`, 64), with longitudes wrapped into [-180, 180] on routes across the
antimeridian. The flight leaves at a random whole five minutes of the departure date in the origin
airport's own time zone. The aircraft fits the distance: a narrow-body (A320neo, B737 MAX) below
`FLIGHT_TRANSIT_LONG_HAUL_KM` (4000 km), a wide-body (A350-900, B787-9, B777-300ER) from there on,
each with its own cruise speed and altitude; flight number and registration are drawn from small
bundled lists. The waypoints follow a climb-cruise-descent profile (`FLIGHT_TRANSIT_CLIMB_KM` 200,
`FLIGHT_TRANSIT_DESCENT_KM` 250, `FLIGHT_TRANSIT_CRUISE_WAYPOINTS` 4): Departure, Top of climb,
Cruise 1..N, Top of descent, Arrival; a flight shorter than climb plus descent (LHR-CDG) gets a
single lower `Peak` instead. Speed changes linearly on climb and descent, so `durationMin` and every
waypoint's time come from the same profile, and the last waypoint lands exactly at `arrivalAt`.
*Why:* the map needs a plausible route and hover details that agree with each other, not real
schedules; all randomness goes through the `Random` port in a fixed draw order, so every scenario is
pinned in unit tests. *Trade-off:* every attempt draws a new report (no seed), so a retried job may
show a different flight than a failed earlier attempt would have; only the completed report is
stored. The generator (`TurfTransitReportGenerator`) sits behind its own `TransitReportGenerator`
port, so the simulated wait and failure are tested apart from the geometry, and a real data source
(`flight-transit-real-data`) can replace it later.

**Flight transit: simulated data-source failures.** Like webhook, a transit attempt waits a fixed
configured time (`FLIGHT_TRANSIT_GENERATE_MS`, 2000 ms) and then fails at the configured rate
(`FLIGHT_TRANSIT_FAILURE_RATE`, 0.1) with `FLIGHT_TRANSIT_DATA_UNAVAILABLE` ("Flight data for
LHR-JFK is unavailable", details `{ origin, destination }`), as if an upstream flight-data source
had nothing for the route. *Why:* retries are exercised on this type too; a lower rate than webhook
keeps most transit jobs completing on the first try. *Trade-off:* about 0.1% of transit jobs fail for
good with 3 attempts; set the rate to 0 for demos. Found while building it: the job a handler gets
was read before job-service counts the attempt on start, so handlers now also receive the queue's
attempt number for their log lines instead of reading the stale `job.attempts`.

**Flight transit: libraries for time zones and geometry.** Node 26 has no native `Temporal`, so a
local time in an IANA zone becomes a UTC instant with `@date-fns/tz` (1.5.0, May 2026, ~41.5M weekly
downloads, own types, ESM); chosen over `temporal-polyfill` (1.0.6, ~6.7M, the standard API but
young) and `luxon` (3.7.2, ~57.7M, but a larger library with its own date type and separate types).
The great-circle distance and the points along the route come from `@turf/distance` and
`@turf/along` (7.4.0, Aug 2026, ~6.3M and ~3.0M weekly downloads, own types, ESM); chosen over
`@turf/great-circle` (~2.4M, gives the whole line at once but splits it into a MultiLineString at the
antimeridian, and still needs `@turf/distance`) and `geolib` (~0.86M, CJS, no point-along-route helper).
Turf measures in radians here so the spec's 6371 km radius holds (its own kilometres use 6371.0088).

---

## 1. Job Pickup Strategy

**Approach chosen:** two layers. BullMQ hands each queue entry (one per attempt, id
`<jobId>_<attempt>`) to one worker at a time: its atomic move from waiting to active is what spreads
work over instances and over the in-process concurrency slots (5 per instance by default). That
alone is not trusted to prevent a double run, so the worker then asks job-service to start the job
(`PATCH /internal/v1/jobs/:id` with `processing`; the worker sends nothing else). job-service reads
the job, checks it is still `pending`, and writes the start in one conditional `UPDATE` that only
matches while the job still has the status and attempts job-service itself just read
(compare-and-set). The loser of any race gets 409 and drops the entry without running anything.
Before starting, the worker reads the job and skips it when it is no longer pending (finished,
cancelled, deleted, or already started), so stale and redelivered entries cost one read.

**Why:** BullMQ's pickup is fast and battle-tested, but a queue entry is not the source of truth:
entries can be redelivered (stalled detection after a crash), and the job's real state lives in
Postgres. Putting the final "may I run this?" decision into one conditional write in Postgres makes
duplicate-free execution independent of queue behaviour, timing or the number of instances. BullMQ's
own retries are off (one try per entry); job-service owns the retry rule and queues a new entry for
the next attempt.

**Trade-offs:** every job costs two extra calls to job-service before it runs (read, start). A
worker never touches the database, so a job-service outage stops all progress; calls are retried a
configured number of times, then given up. Ordering across the queue is BullMQ's (FIFO for now;
priority comes with its own change).

---

## 2. Worker Crash Recovery

**Approach chosen (so far):** prevention and a clean shutdown; the recovery sweep is a later change.
On SIGTERM a worker stops taking entries and lets running jobs finish and report, up to a configured
grace period (10 s; compose waits 15 s before killing). After the grace period the remaining jobs
are abandoned without a report. An attempt is counted when the job starts, so a job that kills its
worker cannot loop forever.

**Why:** state is changed only through job-service, so the worker holds nothing that needs saving;
the only loss is the job it was running. Recovering that job safely needs a rule for when a
`processing` job counts as dead (heartbeat or lease timeout), which is its own change
(`crash-recovery`), together with the sweep that re-queues pending jobs whose entry never reached the
queue.

**What happens if a worker crashes mid-job:** today the job stays `processing`. BullMQ's stalled
detection may hand the entry to another worker, which reads the job, sees it is no longer pending and
drops it, so the job is never run twice, but it is also not finished. The same happens when a report
cannot reach job-service after its retries. The crash-recovery change will detect such jobs and send
them back to pending (or fail them on their last attempt).

---

## 3. Priority Queue Implementation

**Approach chosen:** TBD

**Why:** TBD

---

## 4. Retry Backoff Strategy

**Approach chosen:** TBD

**Timing:** TBD

---

## 5. One Thing I Would Do Differently With More Time

TBD
