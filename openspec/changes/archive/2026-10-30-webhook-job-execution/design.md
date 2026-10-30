# Design

## Context

job-execution-service runs a job by looking up the `JobHandler` for its type in the `JOB_HANDLERS`
map (today only `email`) and calling `run({ job, signal })`. A handler that returns `{ result }`
completes the job; a handler that throws fails it through `JobExecutionImpl.toJobError`, which keeps
`code` and `message` of a `DomainError` and drops `details`. `DomainError` codes must come from the
kernel's `ERROR_CODES`, the closed list of API error codes, each with an HTTP status in the filter.
Job failure codes (`INVALID_PAYLOAD`, `UNSUPPORTED_JOB_TYPE`, `HANDLER_ERROR`) live apart, in
`domain/execution/job-error-codes.ts`. The webhook failure needs a job code (`WEBHOOK_HTTP_ERROR`)
and `details.statusCode`, so the current throw path cannot carry it. See proposal.md for the why.

## Goals / Non-Goals

**Goals:**
- A webhook handler that simulates the call deterministically under test (time and randomness
  through the kernel `Sleeper` and `Random` ports).
- A way for any handler to fail an attempt with its own job error code and `details`.

**Non-Goals:**
- Real HTTP calls, per-status retry rules, retry backoff, new e2e tests (decisions.md).

## Decisions

**1. Handlers report an expected failure as a return value, not an exception.**
`RunJobHandlerResponse` becomes a union: `{ outcome: 'completed', result }` or
`{ outcome: 'failed', error: JobError }`. `JobExecutionImpl` reports `failed` with that error as is
(code, message, details). Thrown errors keep today's path (`DomainError` code or `HANDLER_ERROR`).
- *Alternative: add `WEBHOOK_HTTP_ERROR` to `ERROR_CODES` and throw a `DomainError`.* Rejected:
  `ERROR_CODES` is the API error list and each code needs an HTTP status in the filter; a webhook
  attempt's failure is job data, not an API error. It would also need `toJobError` to start passing
  `details`.
- *Alternative: a special error class in the execution domain that carries a job error.* Works, but
  a simulated 5xx is an expected outcome; returning it keeps exceptions for the unexpected.
The email handler returns `{ outcome: 'completed', result }`.

**2. `JobHandler` moves to `domain/execution/job-handler.ts`** (decided). It is the contract between
execution and every domain module (`notifications`, `webhooks`, later `flight-transit`,
`batch-processing`), so it belongs to execution, not to one of them.

**3. `WebhookJobHandler` in `infra/webhooks/webhook-job-handler.ts`.**
Deps `{ random: Random; sleeper: Sleeper }`, params `{ callMs: number; failureRate: number }`.
`run`: `sleeper.sleep({ ms: callMs, signal })`; then `random.next().value < failureRate` fails the
attempt (so rate 0 never fails and rate 1 always fails, since `next()` is in [0, 1)); a failure picks
`statusCode` from `[500, 502, 503, 504]` with `random.int({ min: 0, max: 3 })` and returns
`{ outcome: 'failed', error: { code: 'WEBHOOK_HTTP_ERROR', message: 'Webhook <METHOD> <url> answered <status>', details: { statusCode } } }`;
a success returns `{ statusCode: 200, responseBody: { received: true, requestId: random.uuid().value } }`,
typed as the contract's `WebhookJobResult`. The code constant lives in
`domain/webhooks/webhook-job-error-codes.ts` (`WEBHOOK_JOB_ERROR_CODES.httpError`), owned by the
webhooks module like `JOB_ERROR_CODES` is owned by execution.

**4. The failure log carries the error's details.** `JobExecutionImpl.fail` already logs
`warn({ jobId, attempt, instanceId, code }, 'Job failed')`; it adds `details`, so the warning shows
`details.statusCode` for webhook failures and invalid-payload issues for others. No log line in the
handler itself, which has no logger and no worker fields.

**5. Settings.** `WEBHOOK_CALL_MS` (integer ≥ 0, default 1500) and `WEBHOOK_FAILURE_RATE` (number in
[0, 1], default 0.2) in `ZodExecutionConfigParser`, as `webhookCallMs` and `webhookFailureRate` in
`ExecutionConfig`; defaults only in the parser's `DEFAULTS`; `.env.example` lists them commented out.
The execution module registers `webhook: new WebhookJobHandler(...)` in `JOB_HANDLERS`.

## Risks / Trade-offs

- [Changing `RunJobHandlerResponse` touches the email handler and `JobExecutionImpl` tests] → small,
  mechanical; done in the same group as the move so every importer changes once.
- [With rate 0.2 and 3 attempts about 0.8% of webhook jobs fail for good] → intended: it exercises
  the final-failure path; tests set the rate to 0 or 1.
- [A fixed wait makes every webhook attempt take exactly the same time] → user's choice; it makes
  the processing state easy to see and keeps the handler simpler.
