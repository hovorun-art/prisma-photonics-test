# Proposal

## Why

job-service can now filter the job list by status and type (`job-list-filters-service`), but the
jobs list in job-ui still shows its status and type filters disabled with a "Coming soon" tooltip.
Users cannot narrow the list to, for example, the failed webhook jobs they want to inspect.

## What Changes

- The status and type filter controls on the jobs list become usable and narrow the list through
  the job-service filters (`GET /v1/jobs?status=...&type=...`).
- Paging, the "Showing x–y of total" line and polling work over the filtered list.
- The filter buttons show faceted counts, served by job-service's statistics route
  (`GET /v1/stats`), which gains optional `status` and `type` parameters.
- The list shows its own state when no job matches the chosen filters.
- Search by job id or idempotency key stays disabled ("Coming soon"); it needs an API this change
  does not add.

Builds on `queue-stats-service` (the statistics route), now archived and merged into master.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `queue-statistics`: `GET /v1/stats` takes optional status and type filters and answers with
  faceted job counts per status and per type; the statistics cards stay unfiltered (the "route
  takes no filters" sentence changes).
- `job-ui`: the jobs list gains working status and type filters; the "Features not built yet are
  shown disabled" requirement no longer lists the status and type filters.

## Impact

- `packages/contracts`: the statistics request gains `status`/`type`, the response a `counts` part.
- `apps/job-service`: the statistics query counts jobs per status and per type under the filters;
  unit, integration and e2e tests.
- `apps/job-ui`: jobs list toolbar, filters in the URL, the list and statistics query hooks, the API
  client, locales, unit tests and the job-ui Playwright tests.
- `tests/system-e2e`: one filter-by-type scenario against the full stack.
- `docs/roadmap/04-all-endpoints.md` intent, `DECISIONS.md`, `README.md`.
