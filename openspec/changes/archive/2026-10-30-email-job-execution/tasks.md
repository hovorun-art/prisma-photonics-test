# Tasks

## Plan

```
1 (codes, ports, config) ─┬─> 2 (EmailJobHandler) ────────┐
                          ├─> 3 (HttpJobRepository) ──────┤
                          ├─> 4 (BullMqJobQueueConsumer) ─┼─> 6 (wiring, e2e, system e2e, docs)
                          └─> 5 (JobExecutionImpl) ───────┘
```

Groups 2–5 could run in parallel after group 1; group 6 is the integration group and runs alone.
Scenario names are from `specs/job-execution` (JE) and `specs/email-job` (EJ). All paths are under
`apps/job-execution-service/` unless they start with `packages/`, `tests/` or the repo root.
Unit tests mock dependencies with `mockDeep` and stub with the `...Once` forms only.

## 1. Error code, ports and config

Owns: `packages/kernel/src/domain/error-codes.ts`, `src/domain/**`,
`src/domain/config/execution-config.ts`, `src/infra/config/zod-execution-config-parser.ts` (+ test),
`package.json` · Depends on: none · Parallel with: none

- [x] 1.1 Add `JOB_SERVICE_UNAVAILABLE` to `ERROR_CODES` (job-service's filter needs no row: job-service never throws it; if typecheck asks for one, map it to 503 there); verify `npm run typecheck`
- [x] 1.2 Write the `domain/` ports with Request/Response types and DI tokens: `JobRepository` (get, update), `JobQueueConsumer` (start, close), `JobExecution` (execute), `JobHandler` (type, run) with `JOB_HANDLERS`; the errors `JobNotFoundError`, `JobStatusConflictError`, `JobServiceUnavailableError` with their unit tests; the job error code constants (`INVALID_PAYLOAD`, `UNSUPPORTED_JOB_TYPE`, `HANDLER_ERROR`); verify the error tests pass
- [x] 1.3 Write failing parser tests for the new settings (required `JOB_SERVICE_URL` and `INTERNAL_SERVICE_TOKEN`; defaults 5 / 1000 / 3000 / 3 / 500 / 5000 / 10000; min ≤ max for the email wait; positive integers), then extend `ExecutionConfig` and `ZodExecutionConfigParser`; verify they pass
- [x] 1.4 Add `bullmq` and `zod` to job-execution-service's dependencies; verify `npm install` and `npm run typecheck`

## 2. Email handler

Owns: `src/infra/notifications/**` · Depends on: 1 · Parallel with: 3, 4, 5

- [x] 2.1 Write failing unit tests for `EmailJobHandler`: "Email job returns a message id" (UUID format, two runs differ), "Email job takes a configured time" (sleeps the duration `random.int` returns within the configured min and max)
- [x] 2.2 Implement `EmailJobHandler`; verify 2.1 passes

## 3. job-service client

Owns: `src/infra/jobs/**` · Depends on: 1 · Parallel with: 2, 4, 5

- [x] 3.1 Write failing integration tests for `HttpJobRepository` against a stub HTTP server: sends the bearer token; `get` returns the parsed `Job`; `update` sends the body and returns the job; 404 → `JobNotFoundError`, 409 → `JobStatusConflictError`; 5xx, connection refused and a slow answer past the timeout → `JobServiceUnavailableError`; a response that is not a valid `Job` → rejected as invalid payload
- [x] 3.2 Implement `HttpJobRepository`; verify 3.1 passes

## 4. Queue consumer

Owns: `src/infra/queue/**` · Depends on: 1 · Parallel with: 2, 3, 5

- [x] 4.1 Write failing integration tests for `BullMqJobQueueConsumer` against Redis (entries added like job-service does: id `<jobId>_<attempt>`, data `{ jobId }`): `execute` receives `{ jobId, attempt }`; "Failed attempt is not redelivered" (an entry is taken once even when `execute` reports a failure); "Concurrent jobs within one instance" (never more than the configured concurrency running at once); `close` stops taking entries and waits for running ones
- [x] 4.2 Implement `BullMqJobQueueConsumer`; verify 4.1 passes

## 5. Execution flow

Owns: `src/infra/execution/**` · Depends on: 1 · Parallel with: 2, 3, 4

- [x] 5.1 Write failing unit tests for `JobExecutionImpl` named after the scenarios: "Pending job runs to completion" (processing, handler, completed with the result, in that order); "Job already taken or finished" and "Job deleted" (no handler, no report); "Another worker started the job first" (409 on start → no handler, no further report, info log); "Invalid payload" (failed `INVALID_PAYLOAD`, no handler); "No handler for the type" (failed `UNSUPPORTED_JOB_TYPE`); "Handler throws a coded error" and "Handler throws an unexpected error" (`HANDLER_ERROR`); "Report succeeds after a retry"; "Report keeps failing" (configured tries, error log with job id, no throw); "Logs of a completed job" (child logger with `jobId` and `attempt`)
- [x] 5.2 Implement `JobExecutionImpl`; verify 5.1 passes

## 6. Wiring, e2e, system e2e and docs (integration)

Owns: `src/app/**`, `src/main.ts`, `test/e2e/**`, `tests/system-e2e/**`, `docker-compose.yml`,
`.env.example`, `DECISIONS.md`, `README.md`, `CLAUDE.md` · Depends on: 2, 3, 4, 5 · Parallel with: none

- [x] 6.1 Write failing per-app e2e tests (real job-execution-service, its own Redis, a simulated job-service stub that serves jobs and records reports, short email wait in env): "Pending job runs to completion", "Job already taken or finished", "Job deleted", "Another worker started the job first", "Invalid payload", "Report succeeds after a retry", "Report keeps failing", "Job running during shutdown", "Grace period runs out", "Logs of a completed job"
- [x] 6.2 Wire the execution module (`JobsModule`/`ExecutionModule` with `useFactory`: `HttpJobRepository`, `EmailJobHandler` in `JOB_HANDLERS`, `JobExecutionImpl`, `BullMqJobQueueConsumer` started on bootstrap) and the shutdown step with the grace period; verify 6.1 passes
- [x] 6.3 Compose and env: `JOB_SERVICE_URL`, `INTERNAL_SERVICE_TOKEN`, `depends_on` job-service healthy and `stop_grace_period` for job-execution-service; new settings commented in `.env.example`; verify `docker compose config`
- [x] 6.4 Write the system e2e "Submitted email job completes end to end" in `tests/system-e2e` (submit, poll until `completed` with a message id) and make it pass on `npm run test:e2e`
- [x] 6.5 Update `DECISIONS.md` (section 1 Job pickup: read-then-start, conditional start in job-service, BullMQ retries off, stalled redelivery dropped; section 2 crash recovery: what a crash or a given-up report means today), `README.md` (a submitted job now completes; scaling) and the job-execution-service line in `CLAUDE.md`; verify the README steps on compose
- [x] 6.6 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`); verify all pass

- [x] 6.7 Found during apply (decisions.md): rename `JobStateApi`/`HttpJobStateApi` to `JobRepository`/`HttpJobRepository` (files, token, Request/Response types); add `p-retry` and replace `JobExecutionImpl`'s own retry loop with `pRetry` (exponential from `JOB_REPORT_RETRY_DELAY_MS`, capped by the new `JOB_REPORT_RETRY_MAX_DELAY_MS`, randomized, only unavailable retried, stopped by `abort()` through its signal); tests first (parser: new setting, default and delay ≤ max; execution: retries with fake timers, give-up after the configured retries, abort during a wait); `.env.example`, a DECISIONS.md entry for the library choice with the npm numbers; rerun the full checks

## Workflow follow-up

- Run `change-verifier` and get PASS, then `/archive email-job-execution` on this branch and merge.
