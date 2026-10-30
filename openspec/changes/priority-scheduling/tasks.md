# Tasks

## Plan

```
1 (contracts) ──┬─> 2 (queue port + BullMQ adapter) ──> 3 (job-service lifecycle) ──┐
                └─> 4 (job-execution-service start) ─────────────────────────────────┴─> 5 (integration)
```

Could run in parallel: group 4 with groups 2 and 3. Everything else is sequential.

## 1. Contracts: execution time, horizon and startable statuses

Owns: `packages/contracts/src/jobs/job.ts`, `packages/contracts/src/jobs/job.test.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Write failing tests in `job.test.ts` for the create request's `scheduledAt` (scenarios "Execution time with a time zone offset" and "Execution time is not a timestamp" at the schema level): accepts `Z` and `+02:00`, is optional, and rejects a date only and a time without offset with an issue at `scheduledAt`; verify they fail for the missing field
- [x] 1.2 Add `scheduledAt: z.iso.datetime({ offset: true }).optional()` to `CreateJobOptions`, `JOB_LIMITS.scheduledAt = { maxAheadDays: 30 }` and `STARTABLE_JOB_STATUSES = ['scheduled', 'pending']`; verify the tests pass and `npm run build:packages` succeeds
- [x] 1.3 Run the `test-case-reviewer` subagent on `packages/contracts` unit tests (`job.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 2. job-service queue port and BullMQ adapter: priority and delay

Owns: `apps/job-service/src/domain/jobs/job-queue.ts`, `apps/job-service/src/infra/jobs/queue/bullmq-job-queue.ts`, `apps/job-service/src/infra/jobs/queue/bullmq-job-queue.int.test.ts`, `apps/job-service/src/app/jobs/jobs.module.ts` · Depends on: 1 · Parallel with: 4

- [x] 2.1 Extend `EnqueueJobQueueRequest` with `priority` and `runAt: string | null` and document the ordering rules on the port; update the existing callers' types only as far as needed to compile (the behaviour comes in group 3), and verify `npm run typecheck` passes
- [x] 2.2 Write failing integration tests in `bullmq-job-queue.int.test.ts` (real Redis, a plain BullMQ `Worker` in the test taking entries one at a time) for "High priority overtakes earlier low priority", "Priorities are taken highest first", "Same priority, first in first out", "Scheduled job is queued for its time" (a delayed entry is not handed out before `runAt`, then is) and "Due scheduled job competes by priority", for both `enqueue` and `enqueueMany`; verify they fail for the expected reason
- [x] 2.3 Implement in `BullMqJobQueue`: `clock` in its deps, priority mapping `JOB_LIMITS.priority.max + 1 - priority` on every entry, `delay = max(0, runAt - now)`; wire `SystemClock` in `jobs.module.ts`; verify the integration tests pass
- [x] 2.4 Run the `test-case-reviewer` subagent on job-service integration tests (`bullmq-job-queue.int.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 3. job-service lifecycle: scheduled submit, horizon, retry priority, scheduled start

Owns: `apps/job-service/src/infra/jobs/job-service.impl.ts`, `apps/job-service/src/infra/jobs/job-service.impl.test.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.int.test.ts`, `apps/job-service/test/e2e/jobs.e2e.test.ts`, `apps/job-service/test/e2e/internal-jobs.e2e.test.ts`, `apps/job-service/test/e2e/job-service-under-test.ts` · Depends on: 1, 2 · Parallel with: 4

- [x] 3.1 Write failing unit tests in `job-service.impl.test.ts` (fake clock) for "Job with a future execution time is scheduled", "Job with a past execution time runs at once", "Job without an execution time", "Execution time too far ahead", "Execution time at the maximum", "Bulk items with and without an execution time", "Bulk item with an execution time too far ahead", "Queue unavailable during a scheduled submit", "Scheduled job is queued for its time" (enqueue with the job's priority and `runAt`), "Retried high-priority job overtakes waiting low-priority jobs" (retry enqueued with the job's priority and `runAt: null`) and "Start a scheduled job"; verify they fail for the expected reason
- [x] 3.2 Implement in `JobServiceImpl`: `newJob` choosing `scheduled`/`pending`, the private horizon check for single and bulk, priority and `runAt` on every enqueue, `processing` accepted from `STARTABLE_JOB_STATUSES`; verify the unit tests pass
- [x] 3.3 Write the repository integration test "Two workers start the same scheduled job" in `prisma-job-repository.int.test.ts` (two concurrent conditional updates from `scheduled`, one wins); verify it passes against real Postgres
- [x] 3.4 Write per-app e2e tests through HTTP: in `jobs.e2e.test.ts` the submit, validation and bulk scenarios of the `job-management` delta (queue mock asserting priority and `runAt` with `toHaveBeenCalledExactlyOnceWith`); in `internal-jobs.e2e.test.ts` "Start a scheduled job" (seeded through the repository) and the unchanged "Start a job that is not pending"; verify they pass
- [x] 3.5 Run the `test-case-reviewer` subagent on job-service unit tests (`job-service.impl.test.ts`), job-service integration tests (`prisma-job-repository.int.test.ts`) and job-service per-app e2e (`jobs.e2e.test.ts`, `internal-jobs.e2e.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 4. job-execution-service: a delivered scheduled job runs

Owns: `apps/job-execution-service/src/infra/execution/job-execution.impl.ts`, `apps/job-execution-service/src/infra/execution/job-execution.impl.test.ts` · Depends on: 1 · Parallel with: 2, 3

- [x] 4.1 Write failing unit tests in `job-execution.impl.test.ts` for "Scheduled job runs to completion" and keep "Job already taken or finished" covering `processing`, `completed`, `failed` and `cancelled`; verify the scheduled case fails because the job is skipped
- [x] 4.2 Skip only jobs whose status is not in `STARTABLE_JOB_STATUSES` (log "job is no longer startable"); verify the tests pass
- [x] 4.3 Run the `test-case-reviewer` subagent on job-execution-service unit tests (`job-execution.impl.test.ts`); add the missing cases it reports or note why they belong elsewhere

Review note (4.3): the reviewer also listed untested branches of `JobExecutionImpl` that predate this change (read error, abort while reading, start report given up, handler resolving after abort, completion/failure report refused, the outcome of "Handler throws an unexpected error"). By the user's choice they go to a separate `fix/` branch.

## 5. Integration: end to end, docs and full checks

Owns: `tests/system-e2e/jobs.spec.ts`, `DECISIONS.md`, `docs/roadmap/05-reliability.md` · Depends on: 1, 2, 3, 4 · Parallel with: none

- [x] 5.1 Write the system e2e test "Scheduled job runs after its time" in `tests/system-e2e/jobs.spec.ts` (a job scheduled a few seconds ahead is `scheduled` with zero attempts, then `completed` with `startedAt >= scheduledAt`; also covers "Scheduled job waits"); verify it passes with `npm run test:e2e`
- [x] 5.2 Run the `test-case-reviewer` subagent on the system e2e (`tests/system-e2e/jobs.spec.ts`); add the missing cases it reports or note why they belong elsewhere
- [x] 5.3 Fill in `DECISIONS.md` section 3 (BullMQ priority with our mapping, FIFO ties, strict priority without ageing, retries keep priority, scheduled jobs as delayed entries vs the rejected promoter, the stuck-`scheduled` risk handed to `crash-recovery`) and update section 1's "FIFO for now" note; verify the text matches `design.md`
- [x] 5.4 Add the `priority-scheduling-ui` change (enable "At a specific time" on the submit page, show the scheduled time) to `docs/roadmap/05-reliability.md`, depending on `priority-scheduling`
- [x] 5.5 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`) and verify all pass

## Workflow follow-up

- Run the `change-verifier` subagent; it must return PASS.
- `/archive priority-scheduling` on this branch, then merge into `master` with the user's approval.
