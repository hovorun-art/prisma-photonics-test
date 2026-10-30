# Proposal

## Why

The task's API list requires "List jobs with filters (status, type)". Today `GET /v1/jobs` only
pages through all jobs, newest first, so a client that wants, say, the failed webhook jobs has to
fetch everything and filter on its own side. This change adds the filters to job-service; the job-ui
controls come later in `job-list-filters-ui`.

## What Changes

- `GET /v1/jobs` accepts filters by job status and by job type, and answers only the matching jobs,
  still a page at a time and newest first.
- Invalid filter values are rejected as a validation error naming the field, like the paging
  parameters today.
- The query contract in `packages/contracts` gains the filter parameters, so job-ui and other
  clients use the same schema; the Swagger docs show them.
- Backend only (job-service). No UI change and no job-execution-service change.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `job-management`: the requirement "Clients can query jobs a page at a time" gains status and type
  filters; "Invalid query parameters are rejected" covers the new parameters.

## Impact

- `packages/contracts`: `QueryJobsRequest` (and, depending on decisions, `QueryJobsResponse`).
- `apps/job-service`: the jobs controller query route, `JobService.query`, `JobRepository.query`
  and its Prisma implementation; the existing `(status, created_at)` and `(type, created_at)`
  indexes already serve these filters.
- Tests: unit tests of the service, the repository integration test and the `jobs` per-app e2e file.
- `docs/roadmap/04-all-endpoints.md`: `job-list-filters` is split into this change and
  `job-list-filters-ui`.
