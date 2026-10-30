# Proposal

## Why

The `webhook-job` change taught job-service the webhook type: clients can submit, store and read
webhook jobs, and the internal API accepts a webhook result or a failed attempt's error. Nothing
runs them yet: job-execution-service has only the email handler, so every queued webhook job fails
with `UNSUPPORTED_JOB_TYPE`. The concept describes the webhook job as a simulated call that takes a
while and fails at random, so that the retry logic is exercised; this change adds that.

## What Changes

- job-execution-service gains a webhook handler in its `webhooks` domain module: it simulates the
  call described by the job's payload, waits a configured time and either
  succeeds with a simulated 2xx status and response body or fails at random, at a configured rate,
  with the error shape agreed in `webhook-job` (code `WEBHOOK_HTTP_ERROR`, the HTTP status in
  `details.statusCode`).
- A failed webhook attempt goes through the existing path: job-service retries it while attempts
  remain and fails the job on the last attempt.
- No contract or job-service change: the payload, result and error shapes exist already.
- Out of scope: real HTTP calls, a new system e2e test, retry backoff (05-reliability `retry-backoff`), the UI.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `webhook-job`: gains how a webhook job runs: the simulated wait, the result of a successful call
  and the random failure with its error.

## Impact

- `apps/job-execution-service`: a webhook `JobHandler` under `infra/webhooks/`, registered in the
  execution module's handler map; new settings (call wait, failure rate) in `ExecutionConfig` and its
  parser; `.env.example` and `docker-compose.yml` if settings are exposed there.
- `JobHandler` moves from `domain/notifications/` to `domain/execution/`, since every domain module
  implements it.
- `DECISIONS.md`: how the simulated failure is produced and why.
