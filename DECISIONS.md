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

**Limits in the shared contract, page sizes in config.** Priority and max-attempts ranges and
defaults and the email field lengths are constants in the shared Zod schemas, so the API and the
UI form validate with the same rules. Values that operators tune (page sizes, enqueue timeout) are
environment config of job-service.

**Internal API protected by a shared service token.** Routes under `/internal` require
`Authorization: Bearer <token>` (compared in constant time) and are left out of the public Swagger
docs. *Trade-off:* a shared secret in environment variables is weaker than service identity (mTLS,
or gRPC with per-service credentials), but needs no certificate setup. It is replaceable behind the
guard.

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
