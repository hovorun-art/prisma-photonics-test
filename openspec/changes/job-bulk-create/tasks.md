# Tasks

## Plan

```
1 (queue: enqueueMany) --> 2 (contracts, group_id, repository, service) --> 3 (HTTP, e2e, docs) --> 4 (integration)
```

Parallel: none. Adding `groupId` to the `Job` contract breaks every Job literal in job-service at
once (repository, service, their tests), so the contract, persistence and service work is one group;
the queue adapter does not touch the contract and goes first so the service can use it.

## 1. Queue: bulk enqueue

Owns: `apps/job-service/src/domain/jobs/job-queue.ts`,
`apps/job-service/src/domain/jobs/errors/job-queue-unavailable.error.ts`,
`apps/job-service/src/infra/jobs/queue/bullmq-job-queue.ts`,
`apps/job-service/src/infra/jobs/queue/bullmq-job-queue.int.test.ts`
· Depends on: none · Parallel with: none

- [x] 1.1 Write failing int tests for `enqueueMany`: one entry per job's first attempt, carrying only the job id; an entry already on the queue is not added twice; with Redis unreachable it rejects with `JobQueueUnavailableError` naming every entry; with Redis stalled it rejects after the configured timeout, and the entries may still land once Redis answers (as with single enqueue; recorded in `DECISIONS.md` in 3.4)
- [x] 1.2 Add `enqueueMany` to `JobQueue` and implement it with `addBulk` under the enqueue timeout (error details list the job ids); verify the int tests pass
- [x] 1.3 Run the `test-case-reviewer` subagent on `apps/job-service/src/infra/jobs/queue/bullmq-job-queue.int.test.ts`; add the missing cases it reports or note why they belong elsewhere

## 2. Contracts, `group_id`, repository and service

Owns: `packages/contracts/src/jobs/job.ts`, `packages/contracts/src/jobs/job.test.ts`,
`apps/job-ui/src/features/jobs/testing/job-fixtures.ts`, `apps/job-ui/test/e2e/jobs.spec.ts`,
`apps/job-execution-service/src/infra/**/*.test.ts` and
`apps/job-execution-service/test/e2e/job-execution-service-under-test.ts` (only `groupId: null` in
Job literals), `apps/job-service/prisma/schema.prisma`,
`apps/job-service/prisma/migrations/<new>_job_group_id/`,
`apps/job-service/src/domain/config/job-service-config.ts`,
`apps/job-service/src/infra/config/zod-job-service-config-parser.ts` and its test, `.env.example`,
`apps/job-service/src/domain/jobs/job-repository.ts`,
`apps/job-service/src/infra/jobs/prisma/prisma-job-repository.ts`,
`apps/job-service/src/infra/jobs/prisma/prisma-job-repository.int.test.ts`,
`apps/job-service/src/domain/jobs/job-service.ts`,
`apps/job-service/src/domain/jobs/errors/bulk-limit-exceeded.error.ts`,
`apps/job-service/src/domain/jobs/errors/invalid-job-field.error.ts`,
`apps/job-service/src/domain/jobs/errors/invalid-job-payload.error.ts`,
`apps/job-service/src/domain/jobs/errors/invalid-job-result.error.ts`,
`apps/job-service/src/infra/jobs/job-service.impl.ts`,
`apps/job-service/src/infra/jobs/job-service.impl.test.ts`,
`apps/job-service/src/app/jobs/jobs.module.ts`,
`docs/roadmap/03-all-job-types.md`, `docs/roadmap/06-bulk-operations.md`
· Depends on: 1 · Parallel with: none

- [ ] 2.1 Write failing contract tests in `job.test.ts`: `CreateJobRequest` accepts an optional UUID `groupId` and rejects a malformed one with an issue on `groupId`; `Job` requires `groupId` (UUID or `null`); `CreateJobsBulkRequest` rejects an empty `jobs` array (issue on `jobs`) and reports an invalid item's issue with the index in its path (`['jobs', 1, 'payload', ...]`); `QueryJobsRequest` accepts one UUID `groupId` and rejects a malformed one
- [ ] 2.2 Add `groupId` to `CreateJobOptions` and `JobBase`, `JOBS_BULK_ROUTE`, `CreateJobsBulkRequest`, `CreateJobsBulkResponse` and the `groupId` query parameter; add `groupId: null` to every Job literal in the owned fixtures and tests; verify the contract tests pass
- [ ] 2.3 Write failing config parser tests for `JOB_SERVICE_BULK_MAX_JOBS` (default 100, positive integer) and `JOB_SERVICE_BULK_BODY_LIMIT_BYTES` (default 1048576, positive integer); add them to the parser, `JobServiceConfig` and `.env.example`; verify the tests pass
- [ ] 2.4 Write failing int tests in `prisma-job-repository.int.test.ts`: a job created with a `groupId` is read back with it, one without has `groupId` `null`; `createMany` stores and returns all jobs in request order with their explicit `createdAt`; a `createMany` where one row violates a database constraint stores none; the query lists a bulk newest first in reverse request order; the `groupId` filter returns only the group's jobs with their `total`, combines with `statuses` and `types`, and an unknown group gives no items and `total` 0
- [ ] 2.5 Add the nullable `group_id uuid` column and the `jobs_group_id_created_at_idx (group_id, created_at desc)` index (schema + migration); in `JobRepository` add `createMany`, optional `createdAt` on `NewJob` and `groupId` on the query request; implement them in `PrismaJobRepository` (`createManyAndReturn`, `groupId` mapping and filter); verify the int tests pass
- [ ] 2.6 Write failing unit tests in `job-service.impl.test.ts`, named after the scenarios: "Single job with a group id" and "Job without a group id" (repository receives `groupId` or `null`), "Mixed job types are created in request order" (repository receives the items with defaults and `createdAt` = now + index ms), "Defaults are applied to each item", "Too many jobs" (`BulkLimitExceededError`, nothing stored), "Largest allowed bulk", "One item breaking a job-service rule" (`VALIDATION_FAILED` issue path starting `jobs.1.payload`, repository not called), "Every bulk job is queued" (`enqueueMany` with each first attempt), "Queue unavailable during bulk submit" (jobs returned, warning logged with the job ids), and `query` passing `groupId` to the repository
- [ ] 2.7 Add `BulkLimitExceededError`, widen `InvalidJobFieldError`'s field to a path, add `createMany` and the query's `groupId` to `JobService` and `JobServiceImpl` (shared private new-job and departure-rule methods with `create`), and pass `bulkMaxJobs` from config in `jobs.module.ts`; verify the unit tests, the existing tests and `npm run typecheck` pass
- [ ] 2.8 Update the roadmap: remove `batch-job` from milestone 3 (job groups replace it), rewrite milestone 6 as `job-bulk-create` and `job-group-service` with no bulk cancel/retry/update/delete; verify by reading both files
- [ ] 2.9 Run the `test-case-reviewer` subagent on `packages/contracts` unit tests (`job.test.ts`), the job-service config parser unit test, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.int.test.ts` and `apps/job-service/src/infra/jobs/job-service.impl.test.ts`; add the missing cases it reports or note why they belong elsewhere

## 3. HTTP route, body limit, e2e and docs

Owns: `apps/job-service/src/app/jobs/jobs.controller.ts`, `apps/job-service/src/app/jobs/job.dto.ts`,
`apps/job-service/src/infra/http/request-body-setup-step.ts` and its test (if any),
`apps/job-service/test/e2e/jobs.e2e.test.ts`, `apps/job-service/test/e2e/errors.e2e.test.ts`,
`apps/job-service/test/e2e/job-service-under-test.ts`, `README.md`, `DECISIONS.md`
· Depends on: 2 · Parallel with: none

- [ ] 3.1 Write failing e2e tests in `jobs.e2e.test.ts` for every scenario of "Clients can submit many jobs in one request", "A bulk submission is all or nothing", "Bulk-submitted jobs are put on the queue", "Jobs can carry a group id" and "Clients can filter the job query by group", named after the scenarios, asserting responses parsed with the contract schemas and the queue mock's calls
- [ ] 3.2 Write failing e2e tests in `errors.e2e.test.ts` for the scenarios of "A bulk submission has a size range" (empty, too many, largest allowed, body above the bulk limit, body above the single-submit limit but within the bulk limit)
- [ ] 3.3 Add `POST /v1/jobs/bulk` to `JobsController` with its DTOs and Swagger docs, the `groupId` query parameter to `GET /v1/jobs`, and the bulk route's own body parser limit in `RequestBodySetupStep`; verify the e2e tests pass and the route appears in `/docs`
- [ ] 3.4 Document it: README "Try it" gets a bulk submit example with a `groupId` and the group query; `DECISIONS.md` records job groups replacing the Batch job type, bulk atomicity (one transaction, one `addBulk`), the request-order `createdAt` offsets, the caller-supplied `groupId`, and the per-route body limit; verify the example request works against `npm run dev`
- [ ] 3.5 Run the `test-case-reviewer` subagent on `apps/job-service` per-app e2e (`jobs.e2e.test.ts`, `errors.e2e.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 4. Integration

Owns: none · Depends on: 3 · Parallel with: none

- [ ] 4.1 Run the full checks (`npm run --silent typecheck`, `npm run --silent lint`, `npm test --silent`) and verify all pass
- [ ] 4.2 Start the stack with `docker compose up --build --wait`, submit a bulk with a `groupId` and query it by group; verify the jobs complete

## Workflow follow-up

- Run the `change-verifier` subagent; archive with `/archive job-bulk-create` after PASS.
- Next change: `job-group-service`.
