# Tasks

## Plan

```
1 (contracts, codes, domain ports) ─┬─> 2 (Prisma storage) ─┐
                                    ├─> 3 (BullMQ queue) ───┼─> 5 (HTTP, wiring, e2e, docs)
                                    └─> 4 (Job service) ──┘
```

Groups 2, 3 and 4 could run in parallel after group 1; group 5 is the integration group and runs
alone. Scenario names below are from `specs/job-management` (JM) and `specs/job-state-reporting`
(JSR). Every interface has only the five operations create, get, query, update, delete.

## 1. Contracts, error codes and domain ports

Owns: `packages/contracts/src/jobs/**`, `packages/contracts/src/index.ts`,
`packages/kernel/src/domain/error-codes.ts`, `apps/job-service/src/domain/jobs/**`,
`apps/job-service/package.json`, `package.json`, `package-lock.json` · Depends on: none · Parallel with: none

- [ ] 1.1 Write failing contract tests (one test file per contract file) for: `CreateJobRequest` accepts a valid email job and applies default priority and max attempts (JM "Defaults are applied"); rejects an unknown type, an invalid `to`, an empty subject, a subject/body over `EMAIL_LIMITS`, priority and max attempts outside `JOB_LIMITS` with an issue on the right path (JM "Unknown job type", "Invalid email address", "Empty subject", "Email field too long", "Priority out of range", "Max attempts out of range"); `QueryJobsRequest` rejects a negative offset and a non-positive limit (JM "Negative offset"); `JobIdParams` rejects a non-UUID (JM "Malformed id"); `UpdateJobRequest` rejects an unknown target status (JSR "Unknown target status"); `EmailJobResult` rejects a result without `messageId` (JSR "Result does not match the job type"). Run `npm run test:unit -w @job-queue/contracts` and see them fail
- [ ] 1.2 Implement the contract files listed in design.md ("Contracts") and export them from `index.ts`; verify 1.1 passes
- [ ] 1.3 Add `JOB_NOT_FOUND` and `JOB_STATUS_CONFLICT` to `ERROR_CODES` with doc comments; verify `npm run typecheck` fails only on the missing rows of the filter's status table (added in 5.1)
- [ ] 1.4 Write the `domain/jobs` interfaces with Request/Response types and DI tokens: `JobService` and `JobRepository` (each exactly create, get, query, update, delete; repository `update` and `delete` take the expected state as a condition), `JobQueue` (`enqueue`), `JobIdFactory`; and the errors `JobNotFoundError`, `JobStatusConflictError` (current status in details), `QueryLimitExceededError` (`VALIDATION_FAILED`, issues on `limit`) with their unit tests (codes and details); verify they pass
- [ ] 1.5 Add `bullmq` to job-service's dependencies and `vitest-mock-extended` as a root dev dependency; verify `npm install` and `npm run build:packages` succeed

## 2. Job storage (Prisma)

Owns: `apps/job-service/prisma/schema.prisma`, `apps/job-service/prisma/migrations/<new>/`,
`apps/job-service/src/infra/jobs/prisma/**` · Depends on: 1 · Parallel with: 3, 4

- [ ] 2.1 Add the `Job` model, `JobType` and `JobStatus` enums and the three indexes from design.md (`(created_at DESC, id DESC)`, `(status, created_at DESC)`, `(type, created_at DESC)`) to the Prisma schema; generate the migration; verify `prisma migrate diff` shows no drift and the migration SQL creates the three indexes
- [ ] 2.2 Write failing integration tests (`prisma-job-repository.int.test.ts`, Testcontainers Postgres): create and get round-trip; get of an unknown id → `JobNotFoundError`; query newest first (ties by id) with limit/offset and total; `update` writes the changes when the expected status and attempts match, and with a stale expectation throws `JobStatusConflictError` with the current status (or `JobNotFoundError` for a missing job); two concurrent `update`s with the same expectation → exactly one succeeds (basis for JSR "Two workers start the same job"); `delete` removes a job whose status is in the allowed set and throws `JobStatusConflictError` / `JobNotFoundError` otherwise
- [ ] 2.3 Implement `PrismaJobRepository` (conditional Prisma `update`/`delete`, `P2025` → one read to pick the error) and `JobRecordMapper` (row → `Job` contract, with its unit test); verify 2.2 passes

## 3. Job queue (BullMQ)

Owns: `apps/job-service/src/infra/jobs/queue/**` · Depends on: 1 · Parallel with: 2, 4

- [ ] 3.1 Write failing integration tests (`bullmq-job-queue.int.test.ts`, Testcontainers Redis): `enqueue` puts one entry on `JOB_QUEUE_NAME` with id `<jobId>_<attempt>` and data `{ jobId }` (JM "Submitted job is queued"); enqueueing the same attempt twice leaves one entry (JM "Same attempt is not queued twice"); with Redis unreachable `enqueue` rejects within the configured timeout instead of hanging
- [ ] 3.2 Implement `BullMqJobQueue` (own connection, `enableOfflineQueue: false`, timeout, `close()`); verify 3.1 passes

## 4. Job service

Owns: `apps/job-service/src/infra/jobs/job-service.impl.ts` (+ test), `apps/job-service/src/infra/jobs/id/**`
· Depends on: 1 · Parallel with: 2, 3

- [ ] 4.1 Write failing unit tests for `JobServiceImpl` create/get/query/delete (every dependency a `mockDeep<Port>()` from `vitest-mock-extended`, passed as `d: JobServiceImplDeps`; fixed clock and id): create stores a pending job with attempts 0 and enqueues attempt 1 (JM "Valid email job is accepted", "Submitted job is queued"); create still returns the job when enqueue rejects and logs a warning with the job id (JM "Queue unavailable during submit"); query applies the configured default limit (JM "Default page size") and throws `QueryLimitExceededError` above the configured maximum (JM "Limit above maximum"); delete passes the finished statuses as the allowed set (JM "Delete a finished job", "Delete a job that has not finished")
- [ ] 4.2 Implement `JobServiceImpl` create/get/query/delete; verify 4.1 passes
- [ ] 4.3 Write failing unit tests for `JobServiceImpl.update`: `processing` on a pending job writes processing, attempts + 1 and the started time with the loaded state as expectation (JSR "Start a pending job"), on any other status throws `JobStatusConflictError` without writing (JSR "Start a job that is not pending"); `completed` validates the result against the job type's schema and throws `VALIDATION_FAILED` without writing on mismatch (JSR "Result does not match the job type"), writes completed with result, cleared error and completed time (JSR "Complete a processing job"), conflicts when not processing (JSR "Complete a job that is not processing"); `failed` with attempts left writes pending with the error and null completed time and enqueues the next attempt (JSR "Failure with attempts left"), still returns the job when that enqueue rejects (JSR "Retry survives an unavailable queue"), on the last attempt writes failed with completed time and enqueues nothing (JSR "Failure on the last attempt"), conflicts when not processing (JSR "Fail a job that is not processing")
- [ ] 4.4 Implement `JobServiceImpl.update` and `CryptoJobIdFactory` (with its unit test: returns a UUID); verify 4.3 passes

## 5. HTTP, wiring, e2e and docs (integration)

Owns: `apps/job-service/src/app/jobs/**`, `apps/job-service/src/app/app.module.ts`,
`apps/job-service/src/app/errors/error-response.filter.ts` (+ test),
`apps/job-service/src/domain/config/job-service-config.ts`,
`apps/job-service/src/infra/config/zod-job-service-config-parser.ts` (+ test),
`apps/job-service/test/e2e/jobs.e2e.test.ts`, `apps/job-service/test/e2e/internal-jobs.e2e.test.ts`,
`apps/job-service/test/e2e/docs.e2e.test.ts`, `apps/job-service/test/e2e/support/**`,
`.env.example`, `docker-compose.yml`, `DECISIONS.md`, `README.md`, `CLAUDE.md` · Depends on: 2, 3, 4 · Parallel with: none

- [ ] 5.1 Add the `JOB_NOT_FOUND` → 404 and `JOB_STATUS_CONFLICT` → 409 rows and filter tests; add the query default limit, query maximum limit and enqueue timeout as fields of the main `JobServiceConfig`, parsed by the existing `ZodJobServiceConfigParser` (no new config file or parser; tests in its existing test file), and document them in `.env.example`; verify typecheck and unit tests pass
- [ ] 5.2 Write failing e2e tests (`jobs.e2e.test.ts`, real Postgres and Redis) named after every JM scenario: "Valid email job is accepted", "Defaults are applied", "Submitted job can be read back", the six invalid-submission scenarios, "Submitted job is queued", "Queue unavailable during submit" (Redis URL pointing at a closed port), "Existing job", "Unknown job", "Malformed id", "Newest first", "Paging", "Default page size", "Empty query result", "Limit above maximum", "Negative offset", "Delete a finished job" (jobs seeded in each finished status), "Delete a job that has not finished", "Delete an unknown job"
- [ ] 5.3 Write failing e2e tests (`internal-jobs.e2e.test.ts`) named after every JSR scenario, through the service token: "Read an existing job", "Read an unknown job", "Unknown target status", "Result does not match the job type", "Report for an unknown job", "Start a pending job", "Start a job that is not pending", "Two workers start the same job" (two parallel requests), "Complete a processing job", "Complete a job that is not processing", "Failure with attempts left", "Retry survives an unavailable queue", "Fail a job that is not processing", "Failure on the last attempt"
- [ ] 5.4 Implement `JobsController` (create, get, query, delete), `InternalJobsController` (get, update) and `JobsModule` (ports wired with `useFactory`, BullMQ queue closed on shutdown) and import it in `AppModule`; verify 5.2 and 5.3 pass
- [ ] 5.5 Extend `docs.e2e.test.ts` with "Docs list the job routes" (submit, get, query, delete under `/v1/jobs` with schemas, still no `/internal`); verify it passes
- [ ] 5.6 Update `DECISIONS.md` (queue ↔ Postgres on the submit and retry side: job id only in messages, `<jobId>_<attempt>` entry ids, five operations with conditional writes instead of per-transition methods, retry rule owned by job-service, attempt counted on start, enqueue failure leaves the job pending until the sweep, the outbox alternative, the query indexes), `README.md` (example `curl` to submit an email job and read it back) and the job-service line in `CLAUDE.md`'s architecture block; verify the README `curl` works against `docker compose up --build --wait`
- [ ] 5.7 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`) and `npm run test:e2e`; verify all pass

## Workflow follow-up

- Run the `change-verifier` subagent and get PASS, then `/archive job-api` on the `job-api` branch.
- Then propose `email-job-execution` and `job-ui-crud`, which can be built in parallel.
