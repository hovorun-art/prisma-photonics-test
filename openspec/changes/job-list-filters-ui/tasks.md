# Tasks

## Plan

1 (contract + locale strings) → 2 (job-service counts) and 3 (job-ui filters) → 4 (integration).
Groups 2 and 3 both need only group 1 and own disjoint files, so they could run in parallel;
group 4 runs last, alone. After group 1 the workspaces that build `QueueStats` (job-service, the
job-ui fixtures) do not typecheck until groups 2 and 3 add `counts`; group 1 verifies with the
contracts workspace only.

## 1. Statistics filters contract and locale strings

Owns: `packages/contracts/src/jobs/queue-stats.ts`, `packages/contracts/src/jobs/queue-stats.test.ts`, `packages/contracts/src/jobs/index.ts`, `apps/job-ui/src/locales/en.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Write failing tests in `queue-stats.test.ts`: `QueryStatsRequest` accepts no parameters, one known `status`, one known `type` and both; rejects an unknown status, an unknown type, an empty value and an array of two values, each with an issue on that field. `QueueStats` with `counts` parses; a missing status or type key in `counts`, a negative and a non-integer count are rejected. Run `npm run test:unit -w packages/contracts` and see them fail
- [x] 1.2 Add `QueryStatsRequest` and the `counts` part of `QueueStats` (design "Contract"), export them from `jobs/index.ts`; verify 1.1 passes and `npm run typecheck -w packages/contracts` passes
- [x] 1.3 In `en.ts` add `list.noMatchTitle` ("No jobs match these filters") and `list.clearFilters` ("Clear filters"); change `list.typeFilters` to the keys `email`, `webhook`, `flight-transit` ("Aircraft transit") and drop `batch`; verify `npm run typecheck -w apps/job-ui` reports no error from `en.ts` itself
- [x] 1.4 Run the `test-case-reviewer` subagent on `packages/contracts` unit tests (`src/jobs/queue-stats.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 2. Faceted counts in job-service

Owns: `apps/job-service/src/domain/jobs/job-statistics.ts`, `apps/job-service/src/domain/jobs/job-counts.ts`, `apps/job-service/src/infra/jobs/job-statistics.impl.ts`, `apps/job-service/src/infra/jobs/job-statistics.impl.test.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-counts.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-counts.int.test.ts`, `apps/job-service/src/app/jobs/stats.controller.ts`, `apps/job-service/src/app/jobs/job.dto.ts`, `apps/job-service/test/e2e/stats.e2e.test.ts`, `apps/job-service/test/e2e/service.e2e.test.ts`, `apps/job-service/test/e2e/job-service-under-test.ts` · Depends on: 1 · Parallel with: 3

- [x] 2.1 Add `countByStatusAndType` with its Response type to `JobCounts`, and `GetJobStatisticsRequest` (`status?`, `type?`) to `JobStatistics.get`; verify `npm run typecheck -w apps/job-service` reports only the not-yet-implemented members
- [x] 2.2 Write failing integration tests in `prisma-job-counts.int.test.ts` for `countByStatusAndType`: an empty table gives no cells; jobs of several statuses and types give one cell per existing pair with its count; jobs finished long before any window are counted. See them fail
- [x] 2.3 Implement `countByStatusAndType` in `PrismaJobCounts` (one `GROUP BY status, type` `$queryRaw`, `::int`); verify 2.2 passes
- [x] 2.4 Write failing unit tests in `job-statistics.impl.test.ts` (`mockDeep<JobCounts>()`), named after the scenarios "Counts without filters", "Status counts under a type filter", "Type counts under a status filter", "Both filters" and "Filters leave the other statistics unchanged" (`count` still called once with the same windows); every status and type key is present with zero when no cell matches. See them fail
- [x] 2.5 Implement the faceting in `JobStatisticsImpl` (design "job-service"); verify 2.4 passes
- [x] 2.6 Write failing e2e tests in `stats.e2e.test.ts`, named after "Counts without filters", "Old finished jobs are counted" (seed through the app's repository), "Status counts under a type filter", "Type counts under a status filter", "Both filters", "Count matches the filtered list total", "Filters leave the other statistics unchanged", "Unknown status filter on statistics", "Unknown type filter on statistics", "Empty filter value on statistics" and "Filter given twice on statistics"; extend the existing "Statistics of an empty queue" to assert all-zero `counts`; let `stats()` in `job-service-under-test.ts` take optional query params. See them fail
- [x] 2.7 Add `QueryStatsDto` and take it in `StatsController.get` with `@Query()`, passing the filters to `JobStatistics.get`; update the operation description; verify 2.6 passes
- [x] 2.8 Extend "Docs list the statistics route" in `service.e2e.test.ts` to assert the `status` and `type` parameters of `GET /v1/stats`; verify it passes
- [x] 2.9 Run the `test-case-reviewer` subagent on job-service unit tests (`src/infra/jobs/job-statistics.impl.test.ts`), integration tests (`src/infra/jobs/prisma/prisma-job-counts.int.test.ts`) and per-app e2e (`test/e2e/stats.e2e.test.ts`, `test/e2e/service.e2e.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 3. Filters and counts in job-ui

Owns: `apps/job-ui/src/features/jobs/api/jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.test.ts`, `apps/job-ui/src/features/jobs/hooks/use-job-filters.ts`, `apps/job-ui/src/features/jobs/hooks/use-job-filters.test.tsx`, `apps/job-ui/src/features/jobs/hooks/use-jobs-page.ts`, `apps/job-ui/src/features/jobs/hooks/use-queue-stats.ts`, `apps/job-ui/src/features/jobs/list/jobs-toolbar.tsx`, `apps/job-ui/src/features/jobs/list/jobs-toolbar.test.tsx`, `apps/job-ui/src/features/jobs/list/jobs-list-page.tsx`, `apps/job-ui/src/features/jobs/list/jobs-list-page.test.tsx`, `apps/job-ui/src/features/jobs/list/queue-stats.tsx`, `apps/job-ui/src/features/jobs/list/queue-stats.test.tsx`, `apps/job-ui/src/features/jobs/testing/job-fixtures.ts`, `apps/job-ui/src/features/app-frame/api-status-pill.test.tsx`, `apps/job-ui/test/e2e/jobs.spec.ts` · Depends on: 1 · Parallel with: 2

- [x] 3.1 Write failing tests in `fetch-jobs-api.test.ts` (MSW): `query` sends `status` and `type` when given and leaves them out otherwise; `stats` sends them likewise and parses a body with `counts`. See them fail
- [x] 3.2 Add optional `status` / `type` to `QueryJobsApiRequest` and a `StatsJobsApiRequest`; build the query strings with `URLSearchParams` in `FetchJobsApi`; add `counts` to the stats fixture in `job-fixtures.ts`; verify 3.1 passes
- [x] 3.3 Write failing tests in `use-job-filters.test.tsx` (memory router), named after "Filters in the URL" (setting Failed and Webhook gives `?status=failed&type=webhook`, All leaves the param out), "Unknown filter value in the URL" (treated as All) and "Clear filters" (both params removed); each change is a new history entry. See them fail
- [x] 3.4 Implement `useJobFilters` (design "Filters from the URL"); verify 3.3 passes
- [x] 3.5 Write failing tests in `jobs-toolbar.test.tsx`, named after "Status filter buttons", "Type filter buttons" (no Batch), "Filters are not disabled", "Disabled search", "Counts without filters" (muted number after each label, All and All types as sums), "Large count on a filter button" and "Counts loading" (no counts, buttons clickable); clicking a button calls `onChange` with that filter. See them fail
- [x] 3.6 Rewrite `JobsToolbar` with `filters`, `counts` and `onChange` props, only search inside `ComingSoon`; verify 3.5 passes
- [x] 3.7 Write failing tests in `jobs-list-page.test.tsx` (MSW, `TestProviders` with a router), named after "Filter by status", "Back to all statuses", "Filter by type", "Status and type together", "Paging through a filtered list", "Filter change on a later page", "No job matches the filters", "Clear filters", "Open a filtered link", "Status counts follow the type filter", "Type counts follow the status filter", "Counts unavailable", "Counts after a filter change" (cards keep values, buttons without counts), "Counts kept on a failed poll", "Cards under a filter", "New matching job appears" and "Failed poll under a filter"; update the existing "No jobs" and disabled-filter assertions to the new specs. See them fail
- [x] 3.8 Thread the filters through `useJobsPage` and `useQueueStats` (keys and `keepPreviousData`, design "One statistics query per poll"), tag the paging in `JobsListPage` with its filters (design "First page on filter change"), add `NoMatchingJobs`, and pass `counts` to the toolbar (hidden while `isPlaceholderData`); keep `QueueStats` cards on the previous values during a filter change; verify 3.7 passes and `queue-stats.test.tsx` and `api-status-pill.test.tsx` still pass (adjust their fixtures for `counts` only)
- [x] 3.9 Add job-ui Playwright tests in `test/e2e/jobs.spec.ts` (mocked API), named after "Reload keeps the filters" and "Back restores the previous filter"; verify `npx playwright test -c apps/job-ui` passes
- [x] 3.10 Run the `test-case-reviewer` subagent on job-ui unit and component tests (`src/features/jobs/api/fetch-jobs-api.test.ts`, `src/features/jobs/hooks/use-job-filters.test.tsx`, `src/features/jobs/list/jobs-toolbar.test.tsx`, `src/features/jobs/list/jobs-list-page.test.tsx`, `src/features/jobs/list/queue-stats.test.tsx`, `src/features/app-frame/api-status-pill.test.tsx`) and the job-ui Playwright tests (`test/e2e/jobs.spec.ts`); add the missing cases it reports or note why they belong elsewhere

## 4. Integration

Owns: `tests/system-e2e/jobs.spec.ts`, `DECISIONS.md`, `README.md`, `docs/roadmap/04-all-endpoints.md` · Depends on: 2, 3 · Parallel with: none

- [ ] 4.1 Add the system e2e scenario in `tests/system-e2e/jobs.spec.ts`: submit an email job and a webhook job through the API, choose Webhook on the jobs list, and see only the webhook row (and the Webhook button's count); verify `npm run test:e2e` passes
- [ ] 4.2 Record in `DECISIONS.md`: faceted counts on `GET /v1/stats` rather than in the list response, one value per filter on that route, the single `GROUP BY status, type` with faceting in the use case, its full-table cost and when a counter table or cache would be added, and filters living only in the URL; add a filtered `GET /v1/stats` example to `README.md`. Verify the text matches decisions.md
- [ ] 4.3 Update the `job-list-filters-ui` intent in `docs/roadmap/04-all-endpoints.md` to include the faceted counts on `GET /v1/stats` (decided); verify the row reads so
- [ ] 4.4 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`) and verify they all pass

## Workflow follow-up

- Run the `change-verifier` subagent; it must return PASS.
- Archive the change with `/archive job-list-filters-ui` on this branch.
- Mark `job-list-filters-ui` in `docs/roadmap/04-all-endpoints.md` as done by this change.
