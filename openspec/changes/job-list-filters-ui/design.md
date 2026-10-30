# Design

## Context

See proposal.md for the motivation and the specs for behaviour. Current state on master:

- `GET /v1/jobs` already takes repeated `status` and `type` filters (`QueryJobsRequest` with
  `RepeatedQueryParam`), and job-ui calls it with `offset` only (`FetchJobsApi.query`).
- `GET /v1/stats` (`StatsController` → `JobStatistics` → `JobCounts` / `PrismaJobCounts`) answers
  `QueueStats` with no request parameters. `PrismaJobCounts` reads only active jobs and jobs
  finished inside the windows, so it never scans all finished jobs.
- job-ui: `JobsToolbar` renders status and type buttons inside `ComingSoon`; `JobsListPage` holds
  the offset in component state; `useQueueStats()` (query key `['stats']`) is shared by the six
  cards and the header `ApiStatusPill`, which lives in the app frame on every page.
- Job types in the contracts: `email`, `webhook`, `flight-transit` (no `batch`).

## Goals / Non-Goals

**Goals:**
- One round trip per poll for the cards, the pill and the filter counts, as today.
- Faceted counts computed from one snapshot of job state.
- The URL is the only place the filters live; the page derives everything from it.

**Non-Goals:**
- Several values per filter in the UI or on `GET /v1/stats` (the job query keeps its own
  repeated filters).
- A cache or materialised counter table for the counts.
- Search (stays `ComingSoon`).

## Decisions

### Contract (`packages/contracts/src/jobs/queue-stats.ts`)

- `QueryStatsRequest = z.object({ status: JobStatus.optional(), type: JobType.optional() })`.
  A repeated parameter reaches the schema as an array and an empty one as `""`, so both fail the
  enum and the existing validation pipe answers 400 `VALIDATION_FAILED` with the field's issue,
  without extra code. Not `RepeatedQueryParam`: one value is what was decided.
- `QueueStats` gains `counts: { status: Record<JobStatus, Count>, type: Record<JobType, Count> }`,
  built as `z.record(JobStatus, Count)` / `z.record(JobType, Count)`, which in Zod 4 requires every
  key: the "every known status and type is present" rule holds by schema, and a new status or type
  added later forces the backend to count it.
- The "All" counts are not in the body: All = the sum of `counts.status` (jobs of the chosen
  type), All types = the sum of `counts.type` (jobs in the chosen status). job-ui adds them up.
  Alternative: `counts.all` fields; rejected as data derivable from the rest.

### job-service

- `JobCounts` gets a second method, `countByStatusAndType(): Promise<CountByStatusAndTypeJobCountsResponse>`
  returning `{ cells: { status, type, count }[] }`, one cell per existing pair. `PrismaJobCounts`
  implements it with one `$queryRaw`:
  `SELECT status, type, count(*)::int AS count FROM jobs GROUP BY status, type`.
  At most 6 × 3 rows; both facets come from the same statement, so from one snapshot.
- `JobStatistics.get(req: GetJobStatisticsRequest)` with `{ status?: JobStatus; type?: JobType }`.
  `JobStatisticsImpl` runs `count` and `countByStatusAndType` (in parallel), and folds the cells:
  `counts.status[s]` = sum of cells with status `s` and (no type filter or type = filter);
  `counts.type[t]` likewise with the status filter; keys start at zero from `JobStatus.options` /
  `JobType.options`. The faceting is plain logic in the use case, unit-tested with a mocked
  `JobCounts`; the SQL stays a dumb group-by. Alternative: two filtered `GROUP BY` queries in
  SQL; rejected because it moves the facet rule into SQL that only an integration test can cover,
  and takes two snapshots.
- The other statistics ignore the filters (spec: "Filters leave the other statistics unchanged");
  `count` is called exactly as before.
- `StatsController.get(@Query() query: QueryStatsDto)`; `QueryStatsDto = createZodDto(QueryStatsRequest)`
  so Swagger lists both parameters; the description says the filters change only `counts`.
- No new index: the group-by reads every job row. See Risks.

### job-ui

- **Filters from the URL** (`features/jobs/hooks/use-job-filters.ts`): `useJobFilters()` reads
  `useSearchParams()`, keeps `status` / `type` only when `JobStatus.safeParse` / `JobType.safeParse`
  accepts them (unknown → All, never sent), and returns `{ filters, setFilters }`. `setFilters`
  writes the params with `setSearchParams` (a push, so Back restores), dropping a filter set to
  All. "Clear filters" calls `setFilters({})`.
- **One statistics query per poll**: `useQueueStats()` takes no argument and calls `useJobFilters()`
  itself, with query key `['stats', filters]` and `placeholderData: keepPreviousData`. The pill
  (app frame) and the cards and toolbar (list page) therefore resolve the same key on the jobs list
  and share one request; on other pages the URL has no filters. While the key changes,
  `isPlaceholderData` is true: the cards keep the previous values, the toolbar hides the counts
  (decided). Alternative: pass filters as an argument; rejected because the pill does not know
  the list's filters and would fire a second, unfiltered request.
- **List query**: `useJobsPage({ offset, filters })`, key `['jobs', { offset, ...filters }]`,
  `JobsApi.query` gains optional `status` / `type`; `FetchJobsApi` builds the query string with
  `URLSearchParams`. `JobsApi.stats(req: StatsJobsApiRequest)` likewise.
- **First page on filter change**: `JobsListPage` reads the filters and renders the table part as
  `<JobsListBody key={status + '|' + type} filters={filters} />`; the offset and previous-offsets
  state live in `JobsListBody`, so any filter change (click, Back, link) remounts it at offset 0.
- **Toolbar** (`JobsToolbar`): props `{ filters, counts, onChange }` where `counts` is
  `{ status, type } | undefined` (undefined while loading, on a first failure and while the
  placeholder shows). Status buttons from `JobStatus.options` with the existing labels; type
  buttons from `JobType.options` with `en.list.typeFilters` (`batch` removed, key `flight-transit`
  → "Aircraft transit"). Each button keeps `aria-pressed` and shows the count as
  `<span class="text-muted-foreground tabular-nums">` after the label, formatted with the existing
  `StatsFormat` count formatter. Only search stays inside `ComingSoon`.
- **Empty state**: `page.total === 0` with any filter set → `NoMatchingJobs` ("No jobs match these
  filters", "Clear filters"); otherwise the existing `EmptyJobs`. Locale keys `list.noMatchTitle`,
  `list.clearFilters`.
- A failed list poll under filters is the existing `keepPreviousData` + `isError` path, now keyed
  by filters; nothing new.

### Tests and module boundaries for the task groups

- Group 1 owns the contract and locales; groups 2 (job-service) and 3 (job-ui) both depend only
  on it and own disjoint files; group 4 (system e2e, docs, roadmap) runs last.
- System e2e: one scenario (decided) submitting an email and a webhook job, choosing Webhook in
  the UI, and seeing only the webhook row.

## Risks / Trade-offs

- [The group-by scans every row of `jobs`, every poll of every open list] → fine at this task's
  scale (one table, an index-only plan is possible later with a `(status, type)` index);
  recorded in `DECISIONS.md` with the threshold at which a counter table or a cache would be added.
- [Counts and the list are two requests, so a count can briefly differ from the list's `total`
  between polls] → both are polled at the same interval; the spec ties them by definition, not by
  snapshot.
- [`keepPreviousData` on a new filter key that fails on its first request drops the placeholder,
  so the cards show "—"] → same as the existing "First statistics request fails" behaviour; the
  next successful poll restores them.
- [The pill now depends on the URL] → only through `useJobFilters`, which is harmless on pages
  without the params; covered by the existing pill tests on the job page.
