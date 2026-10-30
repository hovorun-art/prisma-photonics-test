# Tasks

## Plan

1 (handler contract) → 2 (webhook handler) → 3 (integration). Group 2 implements the interface
group 1 changes, so none run in parallel. No new system e2e or per-app e2e tests (decisions.md).
All paths below are under `apps/job-execution-service/src/` unless stated otherwise.

## 1. Handler contract: move and failed outcome

Owns: `domain/notifications/job-handler.ts` (removed), `domain/execution/job-handler.ts`, `infra/notifications/email-job-handler.ts`, `infra/notifications/email-job-handler.test.ts`, `infra/execution/job-execution.impl.ts`, `infra/execution/job-execution.impl.test.ts`, `app/execution/execution.module.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Move `JobHandler`, `JobHandlers` and `JOB_HANDLERS` to `domain/execution/job-handler.ts` and update every importer; verify `npm run typecheck` and the existing unit tests pass
- [x] 1.2 Write failing tests in `job-execution.impl.test.ts`: a handler returning `{ outcome: 'failed', error }` with `details.statusCode` is reported `failed` with that error as is (code, message, details) and no `completed` report; and "Failed webhook attempt is logged as a warning": the warn line carries `jobId`, `attempt`, `instanceId` and the error's `details.statusCode`; run `npm run test:unit -w apps/job-execution-service` and see them fail
- [x] 1.3 Make `RunJobHandlerResponse` the union `{ outcome: 'completed', result } | { outcome: 'failed', error: JobError }` (design.md decision 1), report a returned failure through `fail`, add `details` to its warn log; update the email handler and its tests to return `outcome: 'completed'`; verify the tests from 1.2 and all existing tests pass

## 2. Webhook handler

Owns: `domain/webhooks/webhook-job-error-codes.ts`, `infra/webhooks/webhook-job-handler.ts`, `infra/webhooks/webhook-job-handler.test.ts` · Depends on: 1 · Parallel with: none

- [x] 2.1 Write failing tests in `webhook-job-handler.test.ts` (mocked `Random` and `Sleeper`, `...Once` stubs) named "Webhook job takes the configured time" (sleeps `callMs` with the signal and does not finish before the sleep resolves), "Failure rate zero never fails", "Failure rate one always fails", "Webhook job returns status 200 and a request id" (two runs, two UUIDs from `randomUUID()`), "Failed webhook attempt carries a 5xx status" (each `random.int` index 0–3 maps to 500, 502, 503, 504; code `WEBHOOK_HTTP_ERROR`; message `Webhook POST https://example.com/hook answered <status>`); see them fail
- [x] 2.2 Add `WEBHOOK_JOB_ERROR_CODES` and `WebhookJobHandler` (design.md decision 3); verify the tests from 2.1 pass

## 3. Integration

Owns: `domain/config/execution-config.ts`, `infra/config/zod-execution-config-parser.ts`, `infra/config/zod-execution-config-parser.test.ts`, `app/execution/execution.module.ts`, `.env.example` (repo root), `DECISIONS.md` (repo root) · Depends on: 1, 2 · Parallel with: none

- [x] 3.1 Write failing parser tests: `WEBHOOK_CALL_MS` and `WEBHOOK_FAILURE_RATE` default to 1500 and 0.2, are read when set, and a failure rate outside [0, 1] or a negative call time is rejected; see them fail
- [x] 3.2 Add `webhookCallMs` and `webhookFailureRate` to `ExecutionConfig` and the parser (defaults only in `DEFAULTS`); list both commented out in `.env.example`; verify the tests from 3.1 pass
- [x] 3.3 Register `webhook: new WebhookJobHandler({ random, sleeper }, { callMs, failureRate })` in `JOB_HANDLERS`; verify `npm run build` succeeds
- [x] 3.4 Update `DECISIONS.md`: handlers return expected failures instead of throwing (and why not a new `ERROR_CODES` entry); the simulated webhook (fixed configured wait, failure drawn after the wait at the configured rate, random 5xx); replace the note that queued webhook jobs fail as `UNSUPPORTED_JOB_TYPE`
- [x] 3.5 Run the full checks (`CHECK_CMDS` in `.claude/flow.conf`: typecheck, lint, test) and verify they pass

## Workflow follow-up

- Run the `change-verifier` subagent and get PASS, then `/archive webhook-job-execution` on this branch.
