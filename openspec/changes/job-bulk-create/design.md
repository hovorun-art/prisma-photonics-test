# Design

## Context

job-service creates jobs one at a time today: `JobsController.create` validates the body with the
`CreateJobRequest` Zod schema, `JobServiceImpl.create` checks the flight transit departure-day rule
(`InvalidJobPayloadError`), `PrismaJobRepository.create` inserts one row (`created_at` defaults to
`now()`), and `BullMqJobQueue.enqueue` adds one BullMQ entry with the id `<jobId>_<attempt>`, bounded
by `enqueueTimeoutMs`; a queue failure is logged and the job stays `pending`. Every route shares one
body limit (`JOB_SERVICE_BODY_LIMIT_BYTES`, 100 KB), set in `RequestBodySetupStep`. The query
maximum (`queryMaxLimit`) is runtime config, so job-service checks it itself
(`QueryLimitExceededError`), not the contract.

See proposal.md for why; requirements are in `specs/job-management/spec.md`.

## Goals / Non-Goals

**Goals:**
- One bulk request = one validation pass, one database transaction, one queue round trip.
- No new code path for "what a job is": bulk items go through the same schema, defaults and rules
  as single submissions.

**Non-Goals:**
- Groups as an entity in job-service (no table, no status); `groupId` is an opaque column.
- Bulk cancel, retry, update or delete; any UI.
- Idempotency of bulk requests (the `idempotency` change will decide that for all submissions).

## Decisions

### Contracts (`packages/contracts/src/jobs/job.ts`)
- `JOBS_BULK_ROUTE = '/v1/jobs/bulk'`.
- `CreateJobOptions` gains `groupId: z.uuid().optional()`, so every `CreateJobRequest` branch (and
  every bulk item) accepts it. `JobBase` gains `groupId: z.uuid().nullable()`.
- `CreateJobsBulkRequest = z.object({ jobs: z.array(CreateJobRequest).min(1) })` and
  `CreateJobsBulkResponse = z.object({ items: z.array(Job) })`. Zod issue paths already carry the
  index (`['jobs', 3, 'payload', 'to']`), so the existing error filter prints `jobs.3.payload.to`
  with no new mapping.
- `QueryJobsRequest` gains `groupId: z.uuid().optional()` (a single value, not repeated).
- The maximum number of jobs is runtime config, so the contract only sets `min(1)`; job-service
  checks the maximum, as it does for the query limit (alternative: a build-time constant in the
  contract, rejected because the user wants it configurable).

### Config (`apps/job-service/src/infra/config`, `.env.example`)
- `JOB_SERVICE_BULK_MAX_JOBS` (default 100) → `bulkMaxJobs`.
- `JOB_SERVICE_BULK_BODY_LIMIT_BYTES` (default 1 048 576) → `bulkBodyLimitBytes`.

### Route-specific body limit (`RequestBodySetupStep`)
Register `json({ limit: bulkBodyLimitBytes })` for the path `JOBS_BULK_ROUTE` before the general
parsers. body-parser marks a parsed request and the general parser then skips it, so the bulk route
gets its own limit and every other route keeps `bodyLimitBytes`. The same error mapping
(`PayloadTooLargeError` with the limit that applied) covers both. Alternative: raising the global
limit to 1 MB, rejected: it widens every route for one use.

### Service (`JobService.createMany`)
New operation `createMany(req: CreateManyJobServiceRequest): Promise<CreateManyJobServiceResponse>`
(`{ jobs: CreateJobRequest[] }` → `{ jobs: Job[] }`):
1. If `jobs.length > bulkMaxJobs`, throw `BulkLimitExceededError` (new, `VALIDATION_FAILED`, one
   issue on path `['jobs']` naming the maximum in its message and `details`), like
   `QueryLimitExceededError`.
2. Run the departure-day rule for every item first. The rule is extracted so it reports issues for
   one item; for item *i* the error is `InvalidJobFieldError` with the field prefix
   `['jobs', i, 'payload']`. `InvalidJobFieldErrorParams.field` widens from `'payload' | 'result'` to
   a path (`PropertyKey[]`), and `InvalidJobPayloadError` keeps passing `['payload']`.
   All items are checked before anything is stored, so nothing is stored on a rule failure.
3. Build the `NewJob`s with the same defaults as `create` (shared private method), each with an
   explicit `createdAt`: `clock.now()` plus *i* milliseconds. Inside one transaction `now()` is the
   same for every row and the id tie-break is random, so without this the request order would be
   lost in the newest-first query (`created_at` has millisecond precision).
4. `repository.createMany` stores them in one transaction.
5. `queue.enqueueMany` puts all first attempts on the queue in one call; on
   `JobQueueUnavailableError` it logs a warning with every job id and still returns the jobs,
   the same rule as `create`.

`create` stays as is (it does not route through `createMany`, so single submit keeps its current
behaviour and tests); both share the private "new job from request" and departure-rule methods.

### Repository (`JobRepository.createMany`, `PrismaJobRepository`)
`createMany({ jobs: NewJob[] }) → { jobs: Job[] }` in request order. Implemented with
`prisma.job.createManyAndReturn` (one `INSERT ... RETURNING`, atomic on its own), then reordered by
the returned rows' position (Postgres returns `RETURNING` rows in insert order, but the method sorts
by `createdAt` to make the order explicit). `NewJob` gets optional `createdAt`; `create` keeps the
database default. `groupId` maps to a new nullable `group_id uuid` column.

### Query filter
`QueryJobServiceRequest` / `QueryJobRepositoryRequest` gain `groupId?: string`; the repository adds
`groupId` to the `where`. New index `jobs_group_id_created_at_idx (group_id, created_at desc)` so the
group service's polling query stays cheap as the table grows.

### Queue (`JobQueue.enqueueMany`, `BullMqJobQueue`)
`enqueueMany({ entries: { jobId, attempt }[] })` → `queue.addBulk(...)` with the same entry ids
(`<jobId>_<attempt>`, so a repeated entry is still ignored) under the same `enqueueTimeoutMs`.
`addBulk` sends all entries in one Redis `MULTI`, so either all are added or none is; on failure it
throws `JobQueueUnavailableError` (details gain the list of job ids). Alternative: calling
`enqueue` N times in parallel, rejected: N round trips and partial results.

### Controller and docs
`JobsController.createBulk` (`@Post('bulk')`; no other POST route under `/v1/jobs` takes a path
segment, so nothing collides), validated with `ZodValidationPipe(CreateJobsBulkRequest)`, returns
`{ items }`. Swagger: `CreateJobsBulkDto`,
`CreateJobsBulkResponseDto`, and the `groupId` query parameter on `GET /v1/jobs`.

### Module boundaries for the task groups
- Contracts + config + migration: shared foundation (group 1).
- Repository and queue adapters (`infra/jobs/prisma`, `infra/jobs/queue`) with their integration
  tests: independent of each other.
- Service (`infra/jobs/job-service.impl.ts`) depends only on the domain ports.
- HTTP (controller, DTOs, body setup step) and the per-app e2e last.

## Risks / Trade-offs

- [Synthetic `createdAt` offsets: the last item of a bulk of 100 is stamped up to 99 ms "in the
  future"] → harmless for ordering and display; noted in `DECISIONS.md`.
- [A bulk is stored but the queue fails] → all its jobs stay `pending`, exactly as single submits do
  today; they are picked up by whatever recovers pending jobs (the `crash-recovery` change). Same
  known gap as single submit, not a new one.
- [`groupId` is caller-supplied and unauthenticated: any client can add jobs to any group] → accepted;
  job-service gives it no meaning, and job-group-service only reads it. Noted in `DECISIONS.md`.
- [A 1 MB body with 100 flight transit jobs costs one validation pass and one insert] → bounded by
  the two configured limits.
- [Adding `groupId` to `Job` changes the contract every app reads] → additive and nullable, no
  behaviour change in job-ui or job-execution-service; the Job literals in their tests and fixtures
  gain `groupId: null` in the same commit as the contract (group 1), so every check stays green.

## Migration Plan

One Prisma migration: `ALTER TABLE jobs ADD COLUMN group_id uuid NULL` plus the index. Existing
rows get `NULL`. Rollback: drop the index and the column.
