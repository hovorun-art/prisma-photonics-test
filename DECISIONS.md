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
(status, attempts, errors, progress, results, logs) go through a separate internal update method.
*Trade-off:* field-level internal attributes (as in gRPC services with per-field permissions) would
express this more precisely; a second method is simpler and enough here. Every state change costs
an HTTP hop from the execution service; timeouts and retries for it are designed with the first job
flow.

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

**Approach chosen:** TBD

**Why:** TBD

**Trade-offs:** TBD

---

## 2. Worker Crash Recovery

**Approach chosen:** TBD

**Why:** TBD

**What happens if worker crashes mid-job:** TBD

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
