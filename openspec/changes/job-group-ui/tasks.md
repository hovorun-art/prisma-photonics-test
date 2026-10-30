# Tasks

## Plan

```
1 (foundations: API routing, GroupsApi, JobsApi groupId, styles, progress model, strings)
├── 2 (groups list page)
└── 3 (group page)
        └── 4 (integration: routes, nav, Playwright, docs, full checks)   ← needs 2 and 3
```

Groups 2 and 3 could run in parallel; everything else is sequential. Paths below are relative to
`apps/job-ui/` unless they start at the repository root.

## 1. Foundations

Owns: `nginx.conf`, `vite.config.ts`, root `.env.example`, root `docker-compose.yml` (job-ui
service only), `src/config/ui-config.ts`, `src/locales/en.ts`, `src/features/jobs/api/jobs-api.ts`,
`src/features/jobs/api/fetch-jobs-api.ts`, `src/features/jobs/api/fetch-jobs-api.test.ts`,
`src/features/jobs/api/json-api-client.ts`, `src/features/jobs/api/fetch-json-api-client.ts`, `src/features/jobs/api/fetch-json-api-client.test.ts` (the
fetch, error-body and parse logic both feature APIs share),
`src/features/jobs/model/status-style.ts`, `src/features/jobs/list/status-badge.tsx`,
`src/features/jobs/testing/test-providers.tsx`, `src/features/groups/api/*`,
`src/features/groups/model/*`, `src/features/groups/testing/*` · Depends on: none · Parallel with:
none

- [x] 1.1 Route `/api/v1/groups*` to job-group-service: a `location /api/v1/groups` in
  `nginx.conf` (port from `JOB_GROUP_SERVICE_PORT`, passed to the job-ui container in
  `docker-compose.yml`), a second Vite proxy key listed before `/api` with target
  `JOB_UI_GROUPS_API_PROXY_TARGET` (`http://localhost:3002` in `.env.example`); verify with
  `npm run dev` that `curl localhost:5173/api/v1/groups` answers job-group-service's page and
  `curl localhost:5173/api/v1/jobs` still answers job-service
- [x] 1.2 Write failing `fetch-jobs-api.test.ts` cases: `query` sends `groupId` and `limit` when
  given and leaves them out otherwise
- [x] 1.3 Add optional `groupId` and `limit` to `QueryJobsApiRequest` and send them in
  `FetchJobsApi.query`; verify 1.2 passes
- [x] 1.4 Write failing `fetch-groups-api.test.ts` (MSW): `query({ offset })` returns the parsed
  page; `get({ id })` returns the parsed group; a 404 throws `ApiError` with
  `JOB_GROUP_NOT_FOUND`; a network failure throws `ApiError` without a code
- [x] 1.5 Add `GroupsApi` (`groups-api.ts`, Request/Response types), `FetchGroupsApi`,
  `GroupsApiContext` and `useGroupsApi`; provide a groups API in `test-providers.tsx`; add
  `groupFixtures` in `src/features/groups/testing/`; verify 1.4 passes
- [x] 1.6 Write failing `group-progress.impl.test.ts` for scenarios "Progress of a running group"
  (3 jobs, 1 completed, 1 failed → 66%, 2 finished, 1 remaining), "Group without jobs" (0%) and
  "Cell colours" (completed → completed, failed and cancelled → failed, every other status →
  remaining)
- [x] 1.7 Implement `GroupProgress` (interface + `GroupProgressImpl`) in
  `src/features/groups/model/`; verify 1.6 passes
- [x] 1.8 Add `GROUP_STATUS_STYLE` next to `STATUS_STYLE` and let `StatusBadge` show a group
  status; add `groupJobsPageSize` (100) to `UiConfig`; add the `groups` strings and the "Groups" nav
  label to `locales/en.ts`; verify `npm run typecheck -w @job-queue/job-ui` and the existing
  job-ui tests pass
- [x] 1.9 Run the `test-case-reviewer` subagent on job-ui unit tests `fetch-jobs-api.test.ts`, `fetch-json-api-client.test.ts`,
  `fetch-groups-api.test.ts` and `group-progress.test.ts`; add the missing cases it reports or note
  why they belong elsewhere

## 2. Groups list page

Owns: `src/features/groups/list/*`, `src/features/groups/hooks/use-groups-page.ts` · Depends on: 1
· Parallel with: 3

- [x] 2.1 Write failing `groups-list-page.test.tsx` (MSW) for "Groups in the table", "Finished
  group in the table", "Running group in the table" and "Open a group from the list"
- [x] 2.2 Implement `useGroupsPage` (polled, keeps the last page, first-load failure to the error
  boundary), `GroupsTable` and `GroupsListPage`; verify 2.1 passes
- [x] 2.3 Write failing tests for "First page of groups", "Next page of groups", "Last page of
  groups", "Loading groups", "No groups", "Groups list fails to load", "Status change appears in
  the groups list" and "API unreachable while polling groups"
- [x] 2.4 Implement paging with the reused `JobsPager`, skeleton rows, "No groups yet", the live
  indicator and the error states; verify 2.3 passes
- [x] 2.5 Run the `test-case-reviewer` subagent on job-ui component test
  `groups-list-page.test.tsx`; add the missing cases it reports or note why they belong elsewhere

## 3. Group page

Owns: `src/features/groups/details/*`, `src/features/groups/hooks/use-group.ts`,
`src/features/groups/hooks/use-group-jobs.ts`, `src/features/groups/hooks/use-group-jobs.test.tsx`
· Depends on: 1 · Parallel with: 2

- [x] 3.1 Write failing `use-group-jobs.test.tsx` (MSW): "One cell per job" (a group of more jobs
  than `groupJobsPageSize` loads every page and returns them oldest first); a job that shows up on
  two pages is returned once
- [x] 3.2 Implement `useGroupJobs` (page loop with `groupId` and `limit`, de-duplicated, reversed,
  polled, keeps the last data); verify 3.1 passes
- [x] 3.3 Write failing `group-page.test.tsx` for "Group page header", "Back to the groups list
  from the breadcrumb", "Group details", "Group not checked or finished yet", "Progress of a
  running group", "Group without jobs", "No timing estimates", "No jobs in the group"
- [x] 3.4 Implement `useGroup`, `GroupPage`, `GroupHeader`, `GroupProgressCard` and
  `GroupDetailsList` per `ui.md`; verify 3.3 passes
- [x] 3.5 Write failing `group-job-cells.test.tsx` for "One cell per job" (header "Jobs 1–n"),
  "Cell colours", "Cell tooltip" and "Open a job from its cell"
- [x] 3.6 Implement `GroupJobCells` (25-column grid of links with the tooltip); verify 3.5 passes
- [x] 3.7 Write failing tests for "Loading a group", "Unknown group id", "Malformed group id" (no
  request made), "Group page fails to load", "Reload a group after a failed load", "Progress
  appears on the group page", "API unreachable while polling a group" and "Group API back again"
- [x] 3.8 Implement skeleton cards, `GroupNotFound` (UUID check with `JobGroupIdParams` before any
  request) and the error and polling states; verify 3.7 passes
- [x] 3.10 Write failing tests for "Group jobs fail to load" and "Group jobs load after a failed
  first load", then show "Could not load the jobs" where the cells go; verify they pass
- [x] 3.9 Run the `test-case-reviewer` subagent on job-ui component tests `group-page.test.tsx`,
  `group-job-cells.test.tsx` and `use-group-jobs.test.tsx`; add the missing cases it reports or
  note why they belong elsewhere

## 4. Integration

Owns: `src/app.tsx`, `src/app.test.tsx`, `src/main.tsx`, `src/features/index.ts`,
`src/features/app-frame/app-frame.tsx`, `src/features/app-frame/app-frame.test.tsx`,
`test/e2e/groups.spec.ts`, root `README.md`, root `DECISIONS.md`,
`docs/roadmap/06-bulk-operations.md` · Depends on: 2, 3 · Parallel with: none

- [x] 4.1 Write failing tests for "Header on every page", "Groups from the header" (app frame) and
  "Direct link to a group" (app routes)
- [x] 4.2 Add the "Groups" nav item, the `/groups` and `/groups/:id` routes, export the pages from
  `features/index.ts` and provide `FetchGroupsApi` in `main.tsx`; verify 4.1 passes
- [x] 4.3 Write `test/e2e/groups.spec.ts` (job-ui Playwright, job-service and job-group-service
  mocked with `page.route`): "Groups from the header", "Open a group from the list", "Back returns
  to the groups list", "Open a job from its cell", "Unknown group id"; verify it passes with
  `npm run test:e2e -w @job-queue/job-ui`
- [x] 4.4 Run the `test-case-reviewer` subagent on job-ui `app-frame.test.tsx`, `app.test.tsx` and
  Playwright `test/e2e/groups.spec.ts`; add the missing cases it reports or note why they belong
  elsewhere
- [x] 4.5 Document the group pages and the `/api/v1/groups` routing in `README.md`; add to
  `DECISIONS.md` the path routing under `/api` and the paged loading of a group's jobs (with its
  limit and the summary route as the fix); update roadmap milestone 6 ("API only, no UI") to
  include this change; verify the documented `curl` commands run as written
- [x] 4.6 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`,
  `npm run format:check`) and verify they pass; then look at both pages with `npm run dev` against
  `ui.md` (screenshot in the scratchpad, compare with the design)

## Workflow follow-up

- Run the `change-verifier` subagent; it must return PASS.
- Archive the change with `/archive job-group-ui` on this branch.
