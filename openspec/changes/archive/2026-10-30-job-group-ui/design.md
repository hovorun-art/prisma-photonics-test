# Design

## Context

job-ui calls job-service only, through one same-origin prefix: `/api/*` is stripped and forwarded
to job-service by the Vite dev proxy (`JOB_UI_API_PROXY_TARGET`) and by nginx in compose
(`apps/job-ui/nginx.conf`). job-group-service (now on master) serves `GET /v1/groups` (paged,
newest first, default page size `JOB_GROUP_QUERY_DEFAULT_LIMIT`) and `GET /v1/groups/:id`
(`JOB_GROUP_NOT_FOUND` → 404) on its own port (`JOB_GROUP_SERVICE_PORT`, 3002); the schemas are in
`packages/contracts/src/groups/job-group.ts`. job-service's `GET /v1/jobs` filters by `groupId`
and pages with `limit` up to `JOB_SERVICE_QUERY_MAX_LIMIT` (default 100).

The job pages already implement the same design language (`features/jobs`): `JobsApi` behind a
React context, TanStack Query hooks polling at `UiConfig.pollIntervalMs`, `StatusBadge`,
`LiveIndicator`, `JobsPager`, `KeyValueList`, `ApiError`, the page error boundary, and the design's
colours as tokens in `index.css`. The design mapping is in `ui.md`.

## Goals / Non-Goals

**Goals:**
- A `features/groups` folder with its own API port, hooks and pages, reusing the jobs feature's
  presentational pieces instead of copying them.
- Reach job-group-service through the same same-origin prefix, so no CORS and no new base URL in
  the browser.

**Non-Goals:**
- No change to job-group-service or job-service; no new routes or filters.
- No system e2e (decided); no group actions.

## Decisions

### Routing the group API: by path under `/api`
`/api/v1/groups*` goes to job-group-service, every other `/api/*` to job-service, in both nginx (a
more specific `location /api/v1/groups`) and the Vite dev proxy (a second proxy key listed first,
target `JOB_UI_GROUPS_API_PROXY_TARGET`, default `http://localhost:3002` in `.env.example`).
compose passes `JOB_GROUP_SERVICE_PORT` to the job-ui container for the nginx template.
- Alternative: a second prefix (`/groups-api`). Rejected: the browser then needs to know which
  service owns which route; path routing keeps the API looking like one gateway and lets the
  routes move between services without touching the UI code.
- job-ui's container does not wait for job-group-service to be healthy (only job-service, as
  today): if it is down, the group pages show their error states, and the jobs pages keep working.

### Groups API port
`GroupsApi` (`features/groups/api/groups-api.ts`) with `query({ offset })` and `get({ id })`,
`FetchGroupsApi` implementing it with `fetch`, parsing answers with `QueryJobGroupsResponse` /
`JobGroup` and throwing the existing `ApiError` (error code from the error body). Provided through
`GroupsApiContext` in `main.tsx`, like `JobsApiContext`; tests provide one pointed at MSW.

### Child jobs: all pages of `GET /v1/jobs?groupId=`
`JobsApi.query` gains optional `groupId` and `limit`. `useGroupJobs(groupId)` loads page after page
with `limit = UiConfig.groupJobsPageSize` (100, job-service's default maximum) until it has `total`
jobs, de-duplicates by id (jobs created between two page reads shift the offsets), and reverses the
newest-first order so cell 1 is the oldest job. One query, polled at `pollIntervalMs`, keeps its
last data on a failed poll.
- Alternative: a new job-service route returning all statuses of a group. Rejected: decided "no
  service change"; the paged loop is enough at this scope (see Risks).

### Status and cell styles
Group statuses get a `GROUP_STATUS_STYLE` map next to `STATUS_STYLE`: running uses the processing
tokens, completed and failed their own. `StatusBadge` takes the style map's class by status, so it
is reused for both. Cell colours: completed `bg-status-processing` (the design's blue `#1F3FC4`),
failed and cancelled `bg-status-failed`, other statuses `bg-border`; the tiles' swatches use the
same three classes (the design's `#DADAD6` swatch becomes `bg-border`, a close token).

### Progress numbers in one model class
`GroupProgress` (`features/groups/model/`) computes finished, percentage (rounded down, 0 for an
empty group) and remaining from a `JobGroup`, and the cell kind from a `JobStatus`. Pure and unit
tested; components only render.

### Pages and components
- `GroupsListPage`: table (short id link, `StatusBadge`, progress text + bar, Created/Finished as
  time of day via the jobs presenter's time format), `JobsPager` reused with the groups total,
  skeleton rows, "No groups yet".
- `GroupPage`: breadcrumb, header (id, badge, `LiveIndicator`), `GroupProgressCard` (percentage,
  counts, bar, tiles, `GroupJobCells`), `GroupDetailsList` (via `KeyValueList`), skeleton cards,
  `GroupNotFound` (non-UUID ids are checked with `JobGroupIdParams` before any request).
- `GroupJobCells`: 25-column grid, each cell a `Link` to `/jobs/:id` with an `aria-label` and the
  shadcn `Tooltip` showing short id and status.
- Routes `/groups`, `/groups/:id` in `app.tsx`; "Groups" in the app frame's nav.
- All strings in `locales/en.ts` under `groups`.

### Tests
Unit/component tests (Vitest + Testing Library + MSW) per spec scenario: `GroupProgress`,
`FetchGroupsApi`, the multi-page loop in `useGroupJobs`, `GroupsListPage`, `GroupPage`,
`GroupJobCells`, app frame and routes. job-ui Playwright (`test/e2e/groups.spec.ts`, API mocked
with `page.route`): list → open a group → cells → open a job; not-found.

## Risks / Trade-offs

- [A very large group loads many pages every poll] → page size is job-service's maximum (100);
  at this scope groups have hundreds of jobs at most. If that grows, a per-group status summary
  route in job-service is the fix; noted in `DECISIONS.md`.
- [Cells and counts disagree for a moment] → decided and stated in the spec; both refresh at the
  same interval.
- [Jobs added while pages are read] → de-duplication by id; a job may appear one poll late.
- [job-group-service down] → the group pages show "Connection lost" or "Something went wrong";
  the jobs pages are unaffected.
