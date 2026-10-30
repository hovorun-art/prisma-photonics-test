# Proposal

## Why

job-service already accepts webhook jobs (`webhook-job`) and `webhook-job-execution` is making the
worker run them, but job-ui still knows only email: the Webhook type card on the submit page is
disabled ("Coming soon"), and the jobs list and job page summarise every job as an email. A user
cannot submit a webhook job from the UI or read its outcome there.

## What Changes

- The submit page lets the user pick the Webhook job type and fill in its payload (method, URL,
  JSON body), following the design's SubmitWebhook screen; the request preview and example response
  follow the webhook form.
- The jobs list and job page show webhook jobs: their Details summary, payload, result (status code
  and response body) and error (including the HTTP status of the failed call).
- The rule that the Webhook job type is shown disabled ("Coming soon") is removed for Webhook;
  Aircraft transit stays disabled.

## Capabilities

### New Capabilities

<!-- None expected; final placement is a decision for decisions.md. -->

### Modified Capabilities

- `job-ui`: submitting a webhook job, showing webhook jobs in the list and on the job page, and
  Webhook no longer listed among the disabled features.

## Impact

- `apps/job-ui`: submit page (type picker, webhook payload form, request preview), list Details
  column, job page cards, locales.
- Uses the existing webhook contract in `packages/contracts` (`WebhookJobPayload`,
  `WebhookJobResult`, `WEBHOOK_METHODS`, `WEBHOOK_LIMITS`); no API change.
- Runs in parallel with `webhook-job-execution` (worker side); the UI does not depend on it to be
  built, only to see webhook jobs actually complete or fail.
- Roadmap milestone 3 gains this change.
