# Tasks

## Plan

1 (contract + locale strings) → 2 (job-service API) and 3 (job-ui) → 4 (integration).
Groups 2 and 3 both need only group 1 and own disjoint files, so they could run in parallel;
group 4 runs last, alone.

## 1. Statistics contract and locale strings

Owns: `packages/contracts/src/jobs/queue-stats.ts`, `packages/contracts/src/jobs/queue-stats.test.ts`, `packages/contracts/src/jobs/index.ts`, `apps/job-ui/src/locales/en.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Write failing tests in `queue-stats.test.ts` for `QueueStats`: a full valid body parses; a negative count, a non-integer count, a negative `perMinute` and a zero or missing `windowMinutes` are rejected. Run `npm run test:unit -w packages/contracts` and see them fail
- [x] 1.2 Add `STATS_ROUTE` (`/v1/stats`) and the `QueueStats` schema and type (design "Contract"), export them from `jobs/index.ts`; verify 1.1 passes
- [x] 1.3 Add the locale strings `frame.apiOnline` ("API online"), `frame.apiOffline` ("API offline") and `list.stats.perMinute` ("/min"); verify `npm run typecheck` passes
- [x] 1.4 Run the `test-case-reviewer` subagent on `packages/contracts` unit tests (`src/jobs/queue-stats.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 2. Statistics route in job-service

Owns: `apps/job-service/src/domain/jobs/job-statistics.ts`, `apps/job-service/src/domain/jobs/job-counts.ts`, `apps/job-service/src/infra/jobs/job-statistics.impl.ts`, `apps/job-service/src/infra/jobs/job-statistics.impl.test.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-counts.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-counts.int.test.ts`, `apps/job-service/prisma/schema.prisma`, `apps/job-service/prisma/migrations/<timestamp>_jobs_status_completed_at_idx/`, `apps/job-service/src/domain/config/job-service-config.ts`, `apps/job-service/src/infra/config/zod-job-service-config-parser.ts`, `apps/job-service/src/infra/config/zod-job-service-config-parser.test.ts`, `apps/job-service/src/app/jobs/stats.controller.ts`, `apps/job-service/src/app/jobs/job.dto.ts`, `apps/job-service/src/app/jobs/jobs.module.ts`, `apps/job-service/test/e2e/stats.e2e.test.ts`, `apps/job-service/test/e2e/service.e2e.test.ts`, `apps/job-service/test/e2e/job-service-under-test.ts` · Depends on: 1 · Parallel with: 3

- [x] 2.1 Write failing tests in `zod-job-service-config-parser.test.ts`: `JOB_SERVICE_STATS_RECENT_WINDOW_MINUTES` and `JOB_SERVICE_STATS_THROUGHPUT_WINDOW_MINUTES` default to 1440 and 5, take given values, and reject zero, negative and non-integer values; see them fail
- [x] 2.2 Add `statsRecentWindowMinutes` and `statsThroughputWindowMinutes` to `JobServiceConfig` and the parser; verify 2.1 passes
- [x] 2.3 Add the `JobStatistics` use case and `JobCounts` port with their Request/Response types and tokens in `domain/jobs/` (design "job-service"); verify `npm run typecheck` passes
- [x] 2.4 Write failing unit tests in `job-statistics.impl.test.ts` (`mockDeep<JobCounts>()`, fake timers): `count` is called once with `recentSince` and `throughputSince` derived from the clock and the configured windows; the response maps the counts and states both window lengths; throughput equals the throughput count divided by the window minutes; all zero counts give zero throughput. See them fail
- [x] 2.5 Implement `JobStatisticsImpl`; verify 2.4 passes
- [x] 2.6 Add the `(status, completed_at)` index to `schema.prisma` and its migration; verify `npx prisma migrate diff` shows no drift and the migration applies in the integration tests
- [x] 2.7 Write failing integration tests in `prisma-job-counts.int.test.ts` against Postgres, named after the spec scenarios: "Current counts by status" (one job in every status), "Completed and failed within the window", "Jobs finished before the window", "Failed attempt that will be retried" (pending with `completed_at` null), "Only completed jobs count towards throughput", "Completions before the throughput window", empty table gives zeros, a job exactly at a `since` instant is counted; see them fail
- [x] 2.8 Implement `PrismaJobCounts` with one `$queryRaw` using `count(*) FILTER (...)` and `::int` casts; verify 2.7 passes
- [x] 2.9 Write failing e2e tests in `test/e2e/stats.e2e.test.ts`, named after the scenarios "Statistics of an empty queue", "Statistics without a service token", "Jobs of every type are counted" (create jobs through `POST /v1/jobs` with the queue mock resolving), "Throughput over the window" (seed completed jobs through the app's repository) and "Database unavailable" (`vi.spyOn(app.get(JOB_COUNTS), 'count').mockRejectedValueOnce(...)`, 500 `INTERNAL_ERROR`); add a `stats()` call to `job-service-under-test.ts` that parses the body with `QueueStats`; see them fail
- [x] 2.10 Add `StatsController` (`GET /v1/stats`, Swagger DTO from `QueueStats`) and register it and the `JOB_COUNTS` / `JOB_STATISTICS` providers in `JobsModule`; verify 2.9 passes
- [x] 2.11 Extend "Docs list the job routes" in `service.e2e.test.ts` (or add "Docs list the statistics route") to assert `GET /v1/stats` and its response schema in the OpenAPI document; verify it passes
- [x] 2.12 Run the `test-case-reviewer` subagent on job-service unit tests (`src/infra/jobs/job-statistics.impl.test.ts`, `src/infra/config/zod-job-service-config-parser.test.ts`), integration tests (`src/infra/jobs/prisma/prisma-job-counts.int.test.ts`) and per-app e2e (`test/e2e/stats.e2e.test.ts`, `test/e2e/service.e2e.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 3. Statistics cards and API status pill in job-ui

Owns: `apps/job-ui/src/features/jobs/api/jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.test.ts`, `apps/job-ui/src/features/jobs/hooks/use-queue-stats.ts`, `apps/job-ui/src/features/jobs/model/stats-format.ts`, `apps/job-ui/src/features/jobs/model/stats-format.test.ts`, `apps/job-ui/src/features/jobs/list/queue-stats.tsx`, `apps/job-ui/src/features/jobs/list/queue-stats.test.tsx`, `apps/job-ui/src/features/jobs/list/jobs-list-page.test.tsx`, `apps/job-ui/src/features/jobs/testing/job-fixtures.ts`, `apps/job-ui/src/features/app-frame/api-status-pill.tsx`, `apps/job-ui/src/features/app-frame/api-status-pill.test.tsx`, `apps/job-ui/src/features/app-frame/app-frame.tsx`, `apps/job-ui/src/features/app-frame/app-frame.test.tsx`, `apps/job-ui/src/features/index.ts`, `apps/job-ui/src/app.test.tsx` · Depends on: 1 · Parallel with: 2

- [ ] 3.1 Write failing tests in `fetch-jobs-api.test.ts` (MSW): `stats()` calls `GET /v1/stats` and returns the parsed body; a body that does not match `QueueStats` and an error answer throw `ApiError`; see them fail
- [ ] 3.2 Add `stats()` with `StatsJobsApiResponse` to `JobsApi` and implement it in `FetchJobsApi`; verify 3.1 passes
- [ ] 3.3 Write failing tests in `stats-format.test.ts` named after "Large count" (`1234` → `1,234`) and "Throughput value" (`2.4` → `2.4/min`, `2.45` → one decimal, `0` → `0.0/min`); see them fail
- [ ] 3.4 Implement `StatsFormat` in `model/stats-format.ts`; verify 3.3 passes
- [ ] 3.5 Write failing tests in `queue-stats.test.tsx` (MSW, `TestProviders`), named after "Statistics shown" (six values in order with their labels), "Statistics loading" (skeletons), "Statistics update by polling" (short `pollIntervalMs`, second answer differs), "Statistics poll fails after values were shown", "First statistics request fails" ("—" in each card) and "Statistics recover"; see them fail
- [ ] 3.6 Add `useQueueStats` (query key `['stats']`, `refetchInterval: pollIntervalMs`, no `throwOnError`) and rewrite `QueueStats` without `ComingSoon`; verify 3.5 passes
- [ ] 3.7 Write failing tests in `api-status-pill.test.tsx`, named after "API online", "API offline" and "API back online"; see them fail
- [ ] 3.8 Implement `ApiStatusPill` with `useQueueStats`, export the hook through `features/index.ts` as needed, and use the pill in `AppFrame` instead of the `ComingSoon` placeholder; verify 3.7 passes
- [ ] 3.9 Update `app-frame.test.tsx`, `jobs-list-page.test.tsx` and `app.test.tsx` for the new `GET /v1/stats` request (MSW handler, stats fixture in `job-fixtures.ts`) and rewrite the "Statistics without data" assertions to the modified scenario (no "Coming soon" on the cards and the pill); in `jobs-list-page.test.tsx` cover "First statistics request fails" from the page's side (the jobs table still shows jobs). Verify `npm run test:unit -w apps/job-ui` passes
- [ ] 3.10 Run the `test-case-reviewer` subagent on job-ui unit and component tests (`src/features/jobs/api/fetch-jobs-api.test.ts`, `src/features/jobs/model/stats-format.test.ts`, `src/features/jobs/list/queue-stats.test.tsx`, `src/features/jobs/list/jobs-list-page.test.tsx`, `src/features/app-frame/api-status-pill.test.tsx`, `src/features/app-frame/app-frame.test.tsx`); add the missing cases it reports or note why they belong elsewhere

## 4. Integration

Owns: `.env.example`, `DECISIONS.md`, `README.md`, `tests/system-e2e/jobs.spec.ts` · Depends on: 2, 3 · Parallel with: none

- [ ] 4.1 Document `JOB_SERVICE_STATS_RECENT_WINDOW_MINUTES` and `JOB_SERVICE_STATS_THROUGHPUT_WINDOW_MINUTES` with their defaults in `.env.example`; verify `npm run dev` starts job-service with them commented out
- [ ] 4.2 Write a system e2e check in `tests/system-e2e/jobs.spec.ts`: `GET /v1/stats` through the stack answers a body matching `QueueStats`; on the jobs list the header pill reads "API online" and the cards show numbers; after an email job is submitted and completes, the Completed card value grows. Verify `npm run test:e2e` passes
- [ ] 4.3 Record in `DECISIONS.md`: separate `GET /v1/stats` instead of extending `/health` (healthchecks stay independent of Postgres), Postgres as the only source, the window definitions and their config, the `(status, completed_at)` index, no server-side cache; add a `GET /v1/stats` example to `README.md`. Verify the text matches decisions.md
- [ ] 4.4 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`) and verify they all pass

## Workflow follow-up

- Run the `change-verifier` subagent; it must return PASS.
- Archive the change with `/archive queue-stats-service` on this branch.
- Mark `queue-health` in `docs/roadmap/04-all-endpoints.md` as done by this change.
