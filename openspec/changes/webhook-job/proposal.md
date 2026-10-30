# Proposal

## Why

Milestone 3 ("All job types") starts with webhook jobs. The UI design ("Job Queue — UI": Submit a
job → Webhook, Job detail) lets a user submit a webhook job and inspect it, including a failed one.
job-service today knows only the email type, so it rejects webhook submissions. This change teaches
job-service the webhook type so the UI and other clients can submit, store and read webhook jobs.
Running them (the simulated call with random failures) is a later step in job-execution-service.

## What Changes

- The shared job contract gains the `webhook` job type: its payload (method, URL, JSON body, as in
  the design's Submit form) and the result a completed webhook job returns.
- `POST /v1/jobs` accepts and validates webhook jobs; `GET /v1/jobs/:id` and `GET /v1/jobs` return
  them alongside email jobs.
- The internal API accepts a completed webhook job's result, checked against the webhook result
  schema, and a failed attempt's error in the shape the design's Job detail page shows.
- Postgres stores the new job type.
- Out of scope: running webhook jobs (job-execution-service), the UI, and the other design fields
  that belong to later milestones (idempotency key, run at, last worker).

## Capabilities

### New Capabilities
- `webhook-job`: what a webhook job is from a client's point of view: its payload, how it is
  validated on submit, and the result and error it reports.

### Modified Capabilities
None. `job-management`'s rules (unknown type, priority and attempt limits) are already generic; only
its Purpose line ("Today the only job type is email") is updated in the main spec.

## Impact

- `packages/contracts` (jobs/job.ts): new webhook schemas, `JobType`, `Job`, `CreateJobRequest`,
  `JOB_RESULT_SCHEMAS`.
- `apps/job-service`: Prisma `JobType` enum and a migration; mapping and OpenAPI docs pick up the
  new type from the contracts.
- job-execution-service: its "unsupported job type" path will see `webhook` jobs once they are
  queued, until its own change adds a handler.
