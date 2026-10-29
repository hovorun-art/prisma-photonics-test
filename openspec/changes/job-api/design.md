# Design

## Context

job-service today has health, Swagger, the error filter, the `/internal` service-token guard, a
Prisma client with no models, and a Redis connection used for nothing yet. job-execution-service has
no job code. The `/api` proxy of the Vite dev server already exists (`JOB_UI_API_PROXY_TARGET`);
the compose nginx proxy is built in `job-ui-crud`. Motivation: proposal.md; behaviour:
`specs/job-management` and `specs/job-state-reporting`.

## Goals / Non-Goals

**Goals:**
- A fixed contract (`packages/contracts`) that `email-job-execution` and `job-ui-crud` can build
  against in parallel without touching job-service.
- Five operations only (create, get, query, update, delete), from the routes down to the
  repository; the lifecycle rules are branches of `update`, the finished-only rule part of `delete`.
- Every write conditional on the state it was decided from, so concurrent reports cannot both win.
- Queue access only through a `JobQueue` port, so BullMQ stays replaceable.

**Non-Goals:**
- No BullMQ worker, no priority on queue entries, no backoff delay, no sweep of pending jobs missing
  from the queue (later changes).
- No public update route, no cancel, no query filters (the indexes are ready for them).

## Decisions

### Routes → operations

| Route | Operation |
|---|---|
| `POST /v1/jobs` | `JobService.create` |
| `GET /v1/jobs/:id`, `GET /internal/v1/jobs/:id` | `JobService.get` |
| `GET /v1/jobs` | `JobService.query` |
| `PATCH /internal/v1/jobs/:id` | `JobService.update` |
| `DELETE /v1/jobs/:id` | `JobService.delete` |

### Contracts (`packages/contracts/src/jobs/`)

One file per concept, each with its schemas and inferred types:

| File | Exports |
|---|---|
| `job-status.ts` | `JobStatus` enum (`scheduled`, `pending`, `processing`, `completed`, `failed`, `cancelled`), `FINISHED_JOB_STATUSES` |
| `email-job.ts` | `EmailJobPayload` `{ to, subject, body }`, `EmailJobResult` `{ messageId }`, `EMAIL_LIMITS` |
| `job-type.ts` | `JobType` enum (`email` only), `JOB_RESULT_SCHEMAS` keyed by type |
| `job.ts` | `Job` (response shape), `JOB_LIMITS` (priority and max-attempts ranges and defaults) |
| `create-job.ts` | `CreateJobRequest`: discriminated union on `type` (one branch per type, today `email`) |
| `query-jobs.ts` | `QueryJobsRequest` (`limit`, `offset`, coerced from query strings), `QueryJobsResponse` `{ items, total }` |
| `job-id.ts` | `JobIdParams` `{ id: uuid }` |
| `update-job.ts` | `UpdateJobRequest`: discriminated union on `status` (`processing`; `completed` + `result`; `failed` + `error`), `JobError` `{ code, message, details? }` |
| `job-queue.ts` | `JOB_QUEUE_NAME`, `JobQueueMessage` `{ jobId }` |
| `routes.ts` | `JOBS_ROUTE` (`/v1/jobs`), `INTERNAL_JOBS_ROUTE` (`/internal/v1/jobs`) |

Values (constants in contracts, decided as "shared Zod schemas, not env config"):
priority integer 1–10, default 5; max attempts integer 1–10, default 3; subject 1–200 characters,
body up to 10 000 characters; `to` is `z.email()`.

A `completed` update's `result` is checked against `JOB_RESULT_SCHEMAS[job.type]` once the job is
loaded (the request does not carry the type); a mismatch is `VALIDATION_FAILED` with the issues
under `result`. Alternative: put the type in the request; rejected because the worker would repeat
what job-service already knows.

`Job` fields: `id`, `type`, `payload`, `status`, `priority`, `attempts`, `maxAttempts`, `result`,
`error`, `scheduledAt`, `startedAt`, `completedAt`, `createdAt`, `updatedAt`; timestamps as ISO
strings (`z.iso.datetime()`), unused ones `null`.

### Error codes

`JOB_NOT_FOUND` (404) and `JOB_STATUS_CONFLICT` (409, `details.status` = current status) are added
to `ERROR_CODES` and the filter's status table. A query `limit` above the configured maximum is
thrown as `QueryLimitExceededError` with code `VALIDATION_FAILED` and `details.issues` in the same
shape as Zod issues (`path: ['limit']`), because the maximum is runtime config and cannot live in
the shared schema.

### Storage

Prisma model `Job` (table `jobs`), first real migration: `id uuid pk`, `type JobType`, `payload
jsonb`, `status JobStatus`, `priority int`, `attempts int`, `max_attempts int`, `result jsonb null`,
`error jsonb null`, `scheduled_at`, `started_at`, `completed_at` (nullable `timestamptz`),
`created_at`, `updated_at`; Postgres enums for type and status. The id comes from a `JobIdFactory`
port (`crypto.randomUUID()`), so tests fix ids.

Indexes:
- `(created_at DESC, id DESC)`: the query's order; `id` breaks ties so offset paging is stable. The
  query sorts by exactly these columns.
- `(status, created_at DESC)`: status filters (`job-list-filters`) and the sweep of pending jobs
  (`crash-recovery`).
- `(type, created_at DESC)`: type filters.

Lookups by id use the primary key. Three indexes on a write-heavy table cost some insert time;
accepted because the query is the UI's main read and polls.

`JobRepository` has the same five operations; writes are conditional (compare-and-set):
- `update({ id, expected: { status, attempts }, changes })`: Prisma `update({ where: { id, status,
  attempts }, data })`. Status alone is not enough: a job can go processing → pending → processing
  between a read and a write (another worker took the retry), so `attempts` is part of the
  condition.
- `delete({ id, allowedStatuses })`: Prisma `delete({ where: { id, status: { in } } })`.
- No row matched (Prisma `P2025`) → the adapter reads the job once: missing → `JobNotFoundError`,
  else `JobStatusConflictError` with the status it read.

Alternative: one raw `UPDATE ... CASE ... RETURNING` per transition; rejected because it puts the
lifecycle rules in SQL and needs extra repository methods.

### `JobService.update` (lifecycle rules)

Load the job (`get`), then by the requested status, all with `expected` = what was loaded and time
from the kernel `Clock`:
- `processing`: job must be `pending` → `{ status: processing, attempts: attempts + 1, startedAt }`.
- `completed`: job must be `processing`; validate `result` → `{ status: completed, result, error:
  null, completedAt }`.
- `failed`: job must be `processing` → `attempts < maxAttempts` ? `{ status: pending, error,
  completedAt: null }` and then `enqueue({ jobId, attempt: attempts + 1 })` : `{ status: failed,
  error, completedAt }`.
- Wrong current status → `JobStatusConflictError` before writing; a lost race → the same error from
  the repository.

Two concurrent `processing` updates both load `pending` with the same attempts; only one
conditional write matches, the other gets 409.

### Queue

`JobQueue` port: `enqueue(req: { jobId, attempt })`. Adapter `BullMqJobQueue`
(`infra/jobs/queue/`) owns a BullMQ `Queue` on `JOB_QUEUE_NAME` with its own connection from
`REDIS_URL` (`enableOfflineQueue: false`, so a down Redis fails instead of buffering) and a
configured enqueue timeout. The entry's data is `JobQueueMessage` `{ jobId }`; its BullMQ job id is
`<jobId>_<attempt>`: BullMQ rejects `:` in custom ids, so the decided `<jobId>:<attempt>` is written
with `_` (same meaning: one entry per attempt, duplicates ignored by BullMQ's id dedupe). Priority is
not passed yet (`priority-scheduling`).

`JobService.create` creates the job (pending, attempts 0) and enqueues attempt 1. Any enqueue failure
(error or timeout) is caught in `JobService`, logged as a warning with `jobId` and `attempt`, and the
response is unchanged (decided: 201 / 200, job stays pending).

### Layers

- `domain/jobs/`: `JobService`, `JobRepository`, `JobQueue`, `JobIdFactory` interfaces with their
  Request/Response types and tokens; `errors/` with `JobNotFoundError`, `JobStatusConflictError`,
  `QueryLimitExceededError`.
- `infra/jobs/`: `job-service.impl.ts` (`JobServiceImpl`, the lifecycle rules), `prisma/`
  (`PrismaJobRepository`, `JobRecordMapper`), `queue/` (`BullMqJobQueue`), `id/`
  (`CryptoJobIdFactory`).
- `app/jobs/`: `JobsController` (`/v1/jobs`, Swagger), `InternalJobsController`
  (`/internal/v1/jobs`, `@ApiExcludeController()`, `ServiceTokenGuard`), DTOs via `createZodDto`,
  `JobsModule` (wiring with `useFactory`, closes the BullMQ queue on shutdown).

Config: three new fields of the main `JobServiceConfig`, parsed by the existing
`ZodJobServiceConfigParser` (no new config file): `JOB_SERVICE_QUERY_DEFAULT_LIMIT=20`,
`JOB_SERVICE_QUERY_MAX_LIMIT=100`, `JOB_SERVICE_ENQUEUE_TIMEOUT_MS=2000` (`.env.example`).
`JobsModule` reads them from `JOB_SERVICE_CONFIG` and passes them as `p` params.

### Unit tests

`JobServiceImpl` and the other classes with collaborators are unit-tested with `mockDeep<Port>()`
(`vitest-mock-extended`, new root dev dependency) for every entry of their `d: <Class>Deps`, so a
port gains a method without touching hand-written doubles; time through `vi.useFakeTimers()`.

### Module boundaries for the task groups

1. Contracts, kernel codes, `domain/jobs` interfaces and errors (shared foundation).
2. `infra/jobs/prisma/` with the Prisma schema and migration.
3. `infra/jobs/queue/`.
4. `infra/jobs/job-service.impl.ts` and `infra/jobs/id/`.
5. `app/jobs/`, config, filter table, e2e, docs (integration).

## Risks / Trade-offs

- [Job stored but not queued stays pending until `crash-recovery` adds the sweep] → logged warning
  with the job id; trade-off and the outbox alternative recorded in `DECISIONS.md`.
- [`update` reads before it writes: one extra query per report] → needed anyway to check the result
  against the job type and to compute the retry; correctness comes from the conditional write.
- [Two Redis connections in job-service (service-kit's and BullMQ's)] → accepted: BullMQ needs its
  own connection options; both close on shutdown.
- [Offset paging slows down on deep pages and can skip or repeat rows while jobs are inserted] →
  acceptable for a UI table; keyset paging is a later option.
- [`_` instead of `:` in queue entry ids differs from the literal decision text] → same behaviour;
  flagged to the user.

## Migration Plan

New migration creating the enums, table and indexes; applied by the compose `migrate` service. No
existing data. Rollback: drop the table and enums.
