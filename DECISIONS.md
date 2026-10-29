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
