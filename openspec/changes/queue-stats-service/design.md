# Design

## Context

job-service owns the `jobs` table (Prisma, Postgres) and serves the public job routes through one
`JobService` in the jobs feature (`domain/jobs`, `infra/jobs`, `app/jobs`). A final failure sets
`status = failed` and `completed_at`; a failed attempt that will be retried goes back to `pending`
with `completed_at = null`, so "failed for good" is simply `status = failed`. The table has indexes
on `(created_at, id)`, `(status, created_at)` and `(type, created_at)`, none on `completed_at`.

job-ui already renders the six cards (`features/jobs/list/queue-stats.tsx`) and the header pill
(`features/app-frame/app-frame.tsx`) inside `ComingSoon` wrappers. It talks to job-service through
`JobsApi` / `FetchJobsApi` (responses parsed with contract schemas), polls with TanStack Query
(`retry: false`, `pollIntervalMs` from `UiConfig`) and is tested with MSW.

## Goals / Non-Goals

**Goals:**
- One read-only route with one database round trip per request.
- The shape of the answer lives once, in `packages/contracts`.
- The cards and the pill share one polled query in job-ui (no second request for the pill).

**Non-Goals:**
- BullMQ/Redis counts, per-type breakdowns, history or charts.
- Caching the statistics on the server; at the configured poll interval one indexed query per
  open UI is cheap.

## Decisions

### Contract (`packages/contracts/src/jobs/queue-stats.ts`)

```ts
export const STATS_ROUTE = '/v1/stats';
export const QueueStats = z.object({
  pending: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(),
  recent: z.object({
    windowMinutes: z.number().int().positive(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  throughput: z.object({
    windowMinutes: z.number().int().positive(),
    perMinute: z.number().nonnegative(),
  }),
});
```
Window lengths are part of the answer so a client can label the numbers without knowing
job-service's config; job-ui keeps its fixed locale labels ("Completed · 24h") as decided. Minutes rather than milliseconds,
because both windows are naturally whole minutes. `perMinute` is not rounded on the server; the
UI rounds for display. Alternative considered: flat `completedLast24h` fields, rejected because
the name would lie once the window is configured differently.

### job-service: a statistics port next to the jobs feature

The statistics read the jobs table, which the jobs feature owns, so they stay inside the jobs
feature rather than a new feature that would reach into another feature's storage:

- `domain/jobs/job-statistics.ts`: use case `JobStatistics.get(): Promise<GetJobStatisticsResponse>`
  (`{ stats: QueueStats }`), token `JOB_STATISTICS`.
- `domain/jobs/job-counts.ts`: port `JobCounts.count(req: CountJobCountsRequest)` with
  `{ recentSince: string; throughputSince: string }` returning
  `{ pending, processing, scheduled, recentCompleted, recentFailed, throughputCompleted }`.
- `infra/jobs/job-statistics.impl.ts`: `JobStatisticsImpl` takes `d: { counts, clock }` and
  `p: { recentWindowMinutes, throughputWindowMinutes }`; computes both `since` instants from
  `clock.now()` and divides `throughputCompleted` by `throughputWindowMinutes`.
- `infra/jobs/prisma/prisma-job-counts.ts`: `PrismaJobCounts`, one `$queryRaw` with
  `count(*) FILTER (WHERE ...)` per number, `::int` casts so Postgres returns numbers rather than
  bigints. One statement gives one consistent snapshot; six Prisma `count` calls would be six round
  trips that can disagree with each other.
- `app/jobs/stats.controller.ts`: `GET /v1/stats` → `JobStatistics.get()`, returns `QueueStats`;
  Swagger DTO via `createZodDto(QueueStats)` in `job.dto.ts`. Registered in `JobsModule` with the
  two providers.

`JobService` stays at its five operations; `JobStatistics` is a separate interface because it
has a different reader and no lifecycle rules. Database failures surface as unknown errors and
the existing filter turns them into 500 `INTERNAL_ERROR`, so no new error code.

### Index

A new migration adds `jobs_status_completed_at_idx` on `(status, completed_at)`. The current
counts use the existing `(status, created_at)` index; the windowed counts filter by status and a
`completed_at` range, which without an index scans every finished job: the table only grows
(deletion is manual), so this would get slower over time.

### Config

Two new job-service settings, parsed by `ZodJobServiceConfigParser`, documented in `.env.example`:
`JOB_SERVICE_STATS_RECENT_WINDOW_MINUTES` (default 1440) and
`JOB_SERVICE_STATS_THROUGHPUT_WINDOW_MINUTES` (default 5), both positive integers.

### job-ui

- `JobsApi.stats(): Promise<StatsJobsApiResponse>` (`{ stats: QueueStats }`), implemented in
  `FetchJobsApi` against `STATS_ROUTE` with the same `send`/`parse` path as the other calls.
- `features/jobs/hooks/use-queue-stats.ts`: `useQuery({ queryKey: ['stats'], refetchInterval:
  pollIntervalMs })`, no `throwOnError`, so a failure never reaches the page error boundary.
  TanStack keeps the last `data` after a failed refetch; `isError` is true while the latest
  request failed.
- `features/jobs/model/stats-format.ts`: `StatsFormat` with `count()` (`Intl.NumberFormat('en-US')`)
  and `throughput()` (one decimal, `/min` unit from the locale file), unit-tested.
- `QueueStats` component: skeleton while `isPending`; values when `data` exists; "—" when there is
  no data and the query failed. `ComingSoon` wrappers are removed.
- `features/app-frame/api-status-pill.tsx`: uses `useQueueStats()` (same query key, so TanStack
  shares one request) and shows "API online" / "API offline"; while the first request is pending
  it keeps the neutral "API status —" text. App-frame imports the hook through `features/index.ts`.
- Locales: `frame.apiOnline`, `frame.apiOffline`, `list.stats.perMinute`.

### Tests per level

- contracts unit: `queue-stats.test.ts` (valid shape, negative counts rejected).
- job-service unit: `job-statistics.impl.test.ts` (windows from the clock, throughput division,
  zero counts), config parser defaults and rejection of non-positive values.
- job-service integration: `prisma-job-counts.int.test.ts` against Postgres: each status, window
  edges, retried failure counted as pending.
- job-service per-app e2e: a new spec-area file `test/e2e/stats.e2e.test.ts` (empty queue, no
  token, every type counted, DB failure → 500 via a spy on the real `JOB_COUNTS` provider); the
  docs scenario extends `service.e2e.test.ts`.
- job-ui component tests with MSW: `queue-stats.test.tsx`, `app-frame.test.tsx`, plus the
  `stats-format` and `fetch-jobs-api` unit tests.
- system e2e: one check in `jobs.spec.ts` that a submitted job moves the cards and the pill reads
  "API online".

## Risks / Trade-offs

- [The windowed counts get slower as finished jobs pile up] → `(status, completed_at)` index;
  volume is measured later in `demo-seed`.
- [Each open UI tab runs one counting query per poll interval] → acceptable at a 2 s interval for a
  demo; a short server-side cache is the next step if `demo-seed` shows it matters.
- [Throughput over a short window jumps between polls] → stated in `DECISIONS.md`; the window is
  configurable.
- [Header pill reflects only the statistics route, not every route] → it is a liveness signal for
  job-service as the UI sees it, which is what the pill promises.

## Migration Plan

One additive migration (the index); no data changes, rollback by dropping the index. The route
and UI are additive; older clients are unaffected.
