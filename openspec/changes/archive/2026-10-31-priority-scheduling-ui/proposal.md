# Proposal

## Why

`priority-scheduling` taught the API to accept an execution time (`scheduledAt`) and to hold such a
job as `scheduled` until that time, but job-ui cannot use it: "At a specific time" on the submit page
is disabled with a "Coming soon" tooltip, and neither the jobs list nor the job page shows when a
scheduled job will run. Users of the UI can therefore neither create nor follow scheduled jobs, one
of the task's critical implementation details.

## What Changes

- On the submit page, the "Run" choice is enabled: "Immediately" (as today) or "At a specific time",
  which shows a date and time input in the user's local time. The chosen time is sent as the
  request's `scheduledAt`, checked before sending with the same rules as the API, and shown in the
  request preview and the example response.
- The jobs list shows when a scheduled job will run.
- The job page shows the job's scheduled time.
- "At a specific time" leaves the list of features shown as "Coming soon".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `job-ui`: the submit form's execution section (run choice, scheduled time, its validation, preview
  and example response), the jobs list and the job page showing the scheduled time, and the
  "Features still to come" list.

## Impact

- `apps/job-ui`: submit form (execution section, form drafts and their schemas, request preview),
  jobs table, job page (details and lifecycle), job presenter, `locales/en.ts`, unit tests and the
  Playwright e2e.
- No change to `packages/contracts`, job-service or job-execution-service: the API already accepts
  and returns `scheduledAt`.
- `tests/system-e2e` may gain a UI flow for a scheduled job.
