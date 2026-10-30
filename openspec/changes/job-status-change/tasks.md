# Tasks

## Plan

1 (contracts, domain interfaces, locale strings) → 2 (job-service), 3 (job-execution-service) and
4 (job-ui) → 5 (integration). Groups 2, 3 and 4 each need only group 1 and own disjoint files, so
they could run in parallel; group 5 runs last, alone. After group 1 the implementing classes in
each app do not typecheck until their group adds the new members; group 1 verifies with the
contracts workspace and the interface files only.

## 1. Contracts, domain interfaces and locale strings

Owns: `packages/contracts/src/jobs/job.ts`, `packages/contracts/src/jobs/job.test.ts`, `packages/contracts/src/jobs/job-queue.ts`, `packages/contracts/src/jobs/job-queue.test.ts`, `packages/contracts/src/jobs/index.ts`, `apps/job-service/src/domain/jobs/job-service.ts`, `apps/job-service/src/domain/jobs/job-queue.ts`, `apps/job-service/src/domain/jobs/job-repository.ts`, `apps/job-execution-service/src/domain/execution/job-execution.ts`, `apps/job-execution-service/src/domain/queue/job-cancellations.ts`, `apps/job-ui/src/features/jobs/api/jobs-api.ts`, `apps/job-ui/src/locales/en.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Write failing tests in `job.test.ts`: `ChangeJobStatusRequest` accepts `{ status: 'cancelled' }` and `{ status: 'pending' }`; rejects `completed`, `processing`, an empty object and an unknown string, each with an issue at `status`; a status that is not a string is rejected at `status`; other fields are dropped. (`CANCELLABLE_JOB_STATUSES` is covered through its uses in 2.5 and 4.3, not as a constant.) Run `npm run test:unit -w packages/contracts` and see them fail
- [x] 1.2 Add `ChangeJobStatusRequest` and `CANCELLABLE_JOB_STATUSES` to `job.ts` (design D1, D2); verify 1.1 passes
- [x] 1.3 Write failing tests in `job-queue.test.ts`: `JobQueueEntryId` encodes `{ jobId, run, attempt }` as `<jobId>_<run>_<attempt>`, decodes it back, decodes a legacy `<jobId>_<attempt>` as run 1, and rejects ids with a non-numeric run or attempt; `JobCancellationMessage` accepts `{ jobId: <uuid> }` and rejects a non-UUID. See them fail
- [x] 1.4 Change `JobQueueAttempt` / `JobQueueEntryId` to carry `run`, add `JOB_CANCELLATIONS_CHANNEL` and `JobCancellationMessage` (design D3, D4), export from `jobs/index.ts`; verify 1.3 passes and `npm run typecheck -w packages/contracts` passes
- [x] 1.5 Extend the domain interfaces: `JobService.changeStatus` with its Request/Response and documented errors; `JobQueue.cancel` with `CancelJobQueueRequest/Response` and `run` on `EnqueueJobQueueRequest`; `JobRepository` returning `StoredJob { job, run }` where the service needs `run` and `run` in `JobChanges` (design D2, D3); `JobExecution.cancel` and the `'cancelled'` outcome; the new port `JobCancellations` with `listen` and its DI token (design D4, D5); `JobsApi.changeStatus` (design D6). Verify the interface files compile (`npx tsc --noEmit` errors only in implementing classes)
- [x] 1.6 Add locale strings to `en.ts`: cancel dialog title, description and confirm label; reuse `deleteCancel` ("Keep job") for dismiss; verify `npm run typecheck -w apps/job-ui` shows no error from `en.ts`
- [x] 1.7 Run the `test-case-reviewer` subagent on `packages/contracts` unit tests (`src/jobs/job.test.ts`, `src/jobs/job-queue.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 2. job-service: status change route, retry re-queue, cancel publish

Owns: `apps/job-service/prisma/schema.prisma`, `apps/job-service/prisma/migrations/<timestamp>_job_run/`, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.int.test.ts`, `apps/job-service/src/infra/jobs/queue/bullmq-job-queue.ts`, `apps/job-service/src/infra/jobs/queue/bullmq-job-queue.int.test.ts`, `apps/job-service/src/infra/jobs/job-service.impl.ts`, `apps/job-service/src/infra/jobs/job-service.impl.test.ts`, `apps/job-service/src/app/jobs/jobs.controller.ts`, `apps/job-service/src/app/jobs/job.dto.ts`, `apps/job-service/src/app/jobs/jobs.module.ts`, `apps/job-service/test/e2e/jobs.e2e.test.ts`, `apps/job-service/test/e2e/internal-jobs.e2e.test.ts`, `apps/job-service/test/e2e/service.e2e.test.ts`, `apps/job-service/test/e2e/job-service-under-test.ts` · Depends on: 1 · Parallel with: 3, 4

- [ ] 2.1 Write failing integration tests in `prisma-job-repository.int.test.ts`: a new job has run 1; an update with `run` stores it and the read returns it; the conditional update still refuses a stale expected status. See them fail
- [ ] 2.2 Add the `run` column (`Int @default(1)`) and its migration; return and update `run` in `PrismaJobRepository` (design D3); verify 2.1 passes
- [ ] 2.3 Write failing integration tests in `bullmq-job-queue.int.test.ts`: entries use `<jobId>_<run>_<attempt>`; attempt 1 of run 2 is added while attempt 1 of run 1 still exists; `cancel` publishes `{ jobId }` on the cancellations channel (a test subscriber receives it); `cancel` against an unreachable Redis rejects with `JobQueueUnavailableError`. See them fail
- [ ] 2.4 Implement `run` in entry ids and `cancel` in `BullMqJobQueue` (design D4); verify 2.3 passes
- [ ] 2.5 Write failing unit tests in `job-service.impl.test.ts` (`mockDeep` repository and queue), named after the scenarios "Cancel a pending job", "Cancel a scheduled job", "Cancel a processing job" (cancel published, attempts unchanged), "Cancel a finished job", "Retry a failed job" (all fields cleared, run + 1), "Retried job is queued" (attempt 1 of the new run), "Retry survives an unavailable queue", "Retry a job that has not failed", "Status change for an unknown job"; plus: a cancel whose publish fails still returns the cancelled job and logs a warning; submit, bulk and failure retries enqueue with the job's run. See them fail
- [ ] 2.6 Implement `changeStatus` and pass `run` on every enqueue in `JobServiceImpl` (design D2, D3); verify 2.5 passes
- [ ] 2.7 Write failing per-app e2e tests in `jobs.e2e.test.ts`, named after "Unsupported target status", "Missing status", "Status change for an unknown job", "Status change with a malformed id", "Cancel a pending job", "Cancel a scheduled job" and "Cancel a processing job" (seeded through the app's repository), "Cancel a finished job", "Retry a failed job", "Retried job is queued" (mock queue received attempt 1 with the new run), "Retry survives an unavailable queue", "Retry a job that has not failed", "Two cancels at the same time", "Two retries at the same time" (one enqueue); add a `changeStatus` call to `job-service-under-test.ts`. See them fail
- [ ] 2.8 Write failing per-app e2e tests in `internal-jobs.e2e.test.ts`, named after "Completion reported after a cancel", "Failure reported after a cancel" (no enqueue) and "Start reported for a cancelled job"; see whichever fail fail (the existing status checks may already cover them; then they guard the behaviour)
- [ ] 2.9 Add `ChangeJobStatusDto` and `PATCH /v1/jobs/:id` in `JobsController` with OpenAPI metadata; wire nothing new in `jobs.module.ts` beyond what the use case needs; verify 2.7 and 2.8 pass
- [ ] 2.10 Extend "Docs list the job routes" in `service.e2e.test.ts` to assert the PATCH route with its request and response schemas; verify it passes
- [ ] 2.11 Run the `test-case-reviewer` subagent on job-service unit tests (`src/infra/jobs/job-service.impl.test.ts`), integration tests (`src/infra/jobs/prisma/prisma-job-repository.int.test.ts`, `src/infra/jobs/queue/bullmq-job-queue.int.test.ts`) and per-app e2e (`test/e2e/jobs.e2e.test.ts`, `test/e2e/internal-jobs.e2e.test.ts`, `test/e2e/service.e2e.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 3. job-execution-service: stop a cancelled job

Owns: `apps/job-execution-service/src/infra/execution/job-execution.impl.ts`, `apps/job-execution-service/src/infra/execution/job-execution.impl.test.ts`, `apps/job-execution-service/src/infra/queue/redis-job-cancellations.ts`, `apps/job-execution-service/src/infra/queue/redis-job-cancellations.int.test.ts`, `apps/job-execution-service/src/infra/queue/bullmq-job-queue-consumer.ts`, `apps/job-execution-service/src/infra/queue/bullmq-job-queue-consumer.int.test.ts`, `apps/job-execution-service/src/app/execution/execution.module.ts`, `apps/job-execution-service/test/e2e/job-execution.e2e.test.ts`, `apps/job-execution-service/test/e2e/service.e2e.test.ts`, `apps/job-execution-service/test/e2e/job-execution-service-under-test.ts` · Depends on: 1 · Parallel with: 2, 4

- [ ] 3.1 Write failing unit tests in `job-execution.impl.test.ts`, named after "Running job is cancelled" (handler signal aborted, no `completed`/`failed` report, info log with job id, outcome `cancelled`), "Cancellation of a job this worker does not run", "Other jobs keep running", "Completion refused after a cancel" (info log, no retry of the report, outcome `skipped`); plus: a cancel that arrives while the `processing` report is in flight stops the job before its handler runs; shutdown abort still abandons as before. See them fail
- [ ] 3.2 Implement per-job abort controllers, `cancel` and the refused-report handling in `JobExecutionImpl` (design D5); verify 3.1 passes
- [ ] 3.3 Write failing integration tests in `redis-job-cancellations.int.test.ts` against real Redis: a published `{ jobId }` reaches `onCancel`; an invalid message is ignored with a warning; `close()` closes its connection once (connection counter from `tests/support`). See them fail
- [ ] 3.4 Implement `RedisJobCancellations` (design D4); verify 3.3 passes
- [ ] 3.5 Update `bullmq-job-queue-consumer.int.test.ts` for entry ids with run (and a legacy id still decoded); adjust the consumer if needed; verify it passes
- [ ] 3.6 Write failing per-app e2e tests in `job-execution.e2e.test.ts` (cancellation delivered through a `mockDeep<JobCancellations>()` whose `listen` callback the test invokes): "Running job is cancelled" and "Other jobs keep running" seen through the mocked `JobRepository` calls; extend the shutdown test in `service.e2e.test.ts` to assert the cancellations connection is closed once. See them fail
- [ ] 3.7 Wire `JobCancellations` in `execution.module.ts` (start listening on bootstrap, calling `JobExecution.cancel`; close on shutdown); verify 3.6 passes
- [ ] 3.8 Run the `test-case-reviewer` subagent on job-execution-service unit tests (`src/infra/execution/job-execution.impl.test.ts`), integration tests (`src/infra/queue/redis-job-cancellations.int.test.ts`, `src/infra/queue/bullmq-job-queue-consumer.int.test.ts`) and per-app e2e (`test/e2e/job-execution.e2e.test.ts`, `test/e2e/service.e2e.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 4. job-ui: Cancel and Retry on the job page

Owns: `apps/job-ui/src/features/jobs/api/fetch-jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.test.ts`, `apps/job-ui/src/features/jobs/hooks/use-change-job-status.ts`, `apps/job-ui/src/features/jobs/model/job-presenter.ts`, `apps/job-ui/src/features/jobs/model/job-presenter.test.ts`, `apps/job-ui/src/features/jobs/model/job-presentation.ts`, `apps/job-ui/src/features/jobs/details/job-header.tsx`, `apps/job-ui/src/features/jobs/details/cancel-job-dialog.tsx`, `apps/job-ui/src/features/jobs/details/retry-job-button.tsx`, `apps/job-ui/src/features/jobs/details/job-page.test.tsx`, `apps/job-ui/test/e2e/jobs.spec.ts` · Depends on: 1 · Parallel with: 2, 3

- [ ] 4.1 Write failing tests in `fetch-jobs-api.test.ts` (MSW): `changeStatus` sends `PATCH /v1/jobs/:id` with `{ status }` and parses the job; an error body becomes `ApiError` with its code. See them fail
- [ ] 4.2 Implement `changeStatus` in `FetchJobsApi`; verify 4.1 passes
- [ ] 4.3 Update `job-presenter.test.ts` so `processing` allows cancel (spec "Cancel a processing job"); see it fail, switch `JobPresenter.actions` to `CANCELLABLE_JOB_STATUSES`, verify it passes
- [ ] 4.4 Write failing tests in `job-page.test.tsx`, named after "Cancel a pending job", "Cancel a processing job", "Keep the job", "No cancel for a finished job", "Retry a failed job", "No retry for a job that has not failed", "Retry in flight", "Cancel in flight", "Cancel rejected", "Retry rejected" and "Cancel and Retry are not disabled"; the updated job shows before the next poll. See them fail
- [ ] 4.5 Implement `useChangeJobStatus`, `CancelJobDialog`, `RetryJobButton` and use them in `JobActions` without `ComingSoon` (design D6); verify 4.4 passes
- [ ] 4.6 Add job-ui Playwright tests in `test/e2e/jobs.spec.ts` (mocked API): cancel from the job page through the dialog, and retry a failed job; verify `npx playwright test -c apps/job-ui` passes
- [ ] 4.7 Run the `test-case-reviewer` subagent on job-ui unit and component tests (`src/features/jobs/api/fetch-jobs-api.test.ts`, `src/features/jobs/model/job-presenter.test.ts`, `src/features/jobs/details/job-page.test.tsx`) and the job-ui Playwright tests (`test/e2e/jobs.spec.ts`); add the missing cases it reports or note why they belong elsewhere

## 5. Integration

Owns: `tests/system-e2e/jobs.spec.ts`, `tests/system-e2e/job-ui.spec.ts`, `DECISIONS.md`, `README.md`, `docs/roadmap/04-all-endpoints.md` · Depends on: 2, 3, 4 · Parallel with: none

- [ ] 5.1 Add system e2e tests, named after "Cancelled waiting job never runs" and "Running job is stopped on the full system" (API, `jobs.spec.ts`), "Retried job runs again on the full system" (API), "Cancel a job from the UI on the full system" and "Retry a job from the UI on the full system" (`job-ui.spec.ts`), using the setups of design D7; verify `npm run test:e2e` passes
- [ ] 5.2 Record in `DECISIONS.md` (design D8): cancellation over Redis pub/sub and the alternatives, the `run` counter in entry ids, the refused-report safety net and cancelling running jobs beyond the task text; add `PATCH /v1/jobs/:id` cancel and retry examples to `README.md`. Verify the text matches decisions.md
- [ ] 5.3 In `docs/roadmap/04-all-endpoints.md`, replace the `job-cancel` and `job-retry` rows with `job-status-change` and answer the open question on cancelling running jobs (yes, decided); verify the file reads so
- [ ] 5.4 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`) and verify they all pass

## Workflow follow-up

- Run the `change-verifier` subagent; it must return PASS.
- `/archive job-status-change` on the change branch, then merge into `master`.
