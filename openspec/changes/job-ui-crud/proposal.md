# Proposal

## Why

Milestone 2 needs one job type working end to end, and the UI is the part a reviewer sees first.
`job-api` is merged, so job-ui can now be built against its fixed contract, in parallel with
`email-job-execution`. Today job-ui only shows a "started" page.

The user has a visual design for the whole UI in Claude Design (artifact
`2c72083e-7fe0-4c29-a748-b0672b62866e`: screens Main, JobDetail, SubmitJob and Components for this
change; Webhook, Transit and Batch screens for later changes). This change builds the part of that
design the current API can support.

## What Changes

- job-ui gets the app frame from the design: header with the product mark, navigation and a
  "New job" action.
- A jobs list page: the jobs from `GET /v1/jobs`, newest first, a page at a time, with each job's
  id, type, status, priority, attempts, a short detail and its creation time, and a link to the job.
- A job details page: the job's status, type, payload, result or error, and its details (priority,
  attempts, timestamps), from `GET /v1/jobs/:id`.
- A submit page for email jobs: recipient, subject, body, priority and max attempts, validated with
  the shared contract schemas, sent to `POST /v1/jobs`.
- Deleting a finished job from the UI (`DELETE /v1/jobs/:id`).
- The list and details refresh by polling, so a job is seen moving from pending to processing to
  completed.
- Design elements that need API features not built yet (status and type filters, cancel, retry,
  queue statistics, health pill, idempotency key, scheduled run time, search, progress) are laid
  out but disabled ("Coming soon"); their own roadmap changes enable them.
- Client-only extras from the design: a lifecycle timeline, a live request preview with "Copy
  cURL", and "Copy as cURL" on the job page.

## Capabilities

### New Capabilities
- `job-ui`: what a user can do with jobs in the web UI: see the list, open a job, submit an email
  job, delete a finished job, and what the UI shows while loading, when empty and on errors.

### Modified Capabilities
- `system-health`: the placeholder requirement "job-ui shows that it has started" is removed; the
  jobs list replaces the started page and calls job-service. `job-management` is unchanged: it
  already offers create, get, query and delete. Edit (a public update route and an edit page) is
  deferred to a later `job-update` change.

## Impact

- `apps/job-ui`: app frame, routing, `features/jobs` (list, details, submit, delete), API client on
  the shared contracts, locale strings in `locales/en.ts`, shadcn components in `components/ui`,
  design tokens (colours, fonts) in the Tailwind theme.
- `packages/contracts`: used as is; no new schemas expected.
- Tests: component tests with MSW, job-ui Playwright e2e, and a system e2e flow (submit → list →
  job page) on the compose stack.
- `docs/roadmap/`: milestone 2 drops "edits" from this change's intent; a new `job-update` change in
  milestone 4 takes the public update and the edit page.
