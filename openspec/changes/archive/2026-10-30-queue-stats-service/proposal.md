# Proposal

## Why

The task asks for a "health check with queue statistics", and the job-ui jobs list already shows
six statistics cards (Pending, Processing, Scheduled, Completed · 24h, Failed · 24h, Throughput)
and an "API status" pill, all disabled with "—" because no statistics API exists yet. This change
adds a small statistics API to job-service and fills those cards with live numbers.

## What Changes

- job-service gets a public read-only endpoint that returns job queue statistics (route, data
  source and metrics decided in `decisions.md`).
- `packages/contracts` gets the Zod schema of the statistics response, shared by job-service and
  job-ui.
- job-ui shows the statistics on the jobs list in the existing cards, refreshed by polling, and
  no longer shows them as "Coming soon".
- `DECISIONS.md` and `README.md` record the endpoint and how the numbers are computed.

## Capabilities

### New Capabilities

- `queue-statistics`: the statistics endpoint of job-service: which numbers it reports, over which
  time window, and how it answers when its data source is unavailable.

### Modified Capabilities

- `job-ui`: the queue statistics cards on the jobs list show live numbers instead of being
  disabled "Coming soon" placeholders.

## Impact

- `apps/job-service`: new route, use case and query over job state; OpenAPI docs.
- `packages/contracts`: new statistics schema.
- `apps/job-ui`: `features/jobs` API client, a polling hook, the `QueueStats` component, locales.
- Tests: unit, integration (the query against real Postgres), job-service per-app e2e, job-ui
  component tests, system e2e.
