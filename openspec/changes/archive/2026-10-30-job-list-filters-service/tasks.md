# Tasks

## Plan

1 (contract) → 2 (job-service) → 3 (integration). Group 2 needs the new contract fields, so the
groups run one after another; parallel: none.

## 1. Query contract

Owns: `packages/contracts/src/jobs/job.ts`, `packages/contracts/src/jobs/job.test.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Write failing tests in `job.test.ts` for `QueryJobsRequest`: one `status` string becomes a one-element array; repeated values become an array; duplicates are removed; an unknown value, an empty string and an unknown value among known ones fail with an issue on `status`; the same cases for `type`; without the fields both stay undefined. Run `npm run test:unit -w packages/contracts` and see them fail
- [x] 1.2 Add the optional `status` and `type` fields to `QueryJobsRequest` (string or non-empty array of the enum, normalised to a de-duplicated array) and update its doc comment; verify the tests from 1.1 pass
- [x] 1.3 Run the `test-case-reviewer` subagent on `packages/contracts` unit tests (`src/jobs/job.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 2. Filtered job query in job-service

Owns: `apps/job-service/src/domain/jobs/job-service.ts`, `apps/job-service/src/domain/jobs/job-repository.ts`, `apps/job-service/src/infra/jobs/job-service.impl.ts`, `apps/job-service/src/infra/jobs/job-service.impl.test.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.int.test.ts`, `apps/job-service/src/app/jobs/jobs.controller.ts`, `apps/job-service/src/app/jobs/job.dto.ts`, `apps/job-service/test/e2e/jobs.e2e.test.ts`, `apps/job-service/test/e2e/service.e2e.test.ts`, `apps/job-service/test/e2e/job-service-under-test.ts` · Depends on: 1 · Parallel with: none

- [x] 2.1 Add optional `statuses` and `types` to `QueryJobServiceRequest` and `QueryJobRepositoryRequest`; verify `npm run typecheck` passes
- [x] 2.2 Write failing unit tests in `job-service.impl.test.ts`: `query` passes `statuses` and `types` to the repository unchanged together with the resolved limit and offset (`toHaveBeenCalledExactlyOnceWith`); see them fail
- [x] 2.3 Pass the filters through in `JobServiceImpl.query`; verify 2.2 passes
- [x] 2.4 Write failing integration tests in `prisma-job-repository.int.test.ts`: filter by one status, by several statuses, by one and several types, status and type together, paging through filtered jobs (`total` counts only matching jobs), no matching job; see them fail
- [x] 2.5 Build one Prisma `where` from the filters in `PrismaJobRepository.query`, used by both `findMany` and `count`; verify 2.4 and the existing query tests pass
- [x] 2.6 Write failing e2e tests in `jobs.e2e.test.ts` for the HTTP wiring and HTTP answers, named after the spec scenarios "Filter by one status", "Filter by several statuses", "Repeated status value", "Filter by one type", "Unknown status filter", "Unknown type filter", "Empty filter value", "One unknown value among known ones" (repeated query parameters built with `URLSearchParams`; seed jobs in the needed statuses through the app's repository); see them fail. "Filter by several types", "Status and type together", "Paging through filtered jobs" and "No job matches the status" are adapter behaviour, tested once against Postgres in 2.4 (after the test review: each case at the lowest level that can see it)
- [x] 2.7 Pass `query.status` and `query.type` from `JobsController.query` to `JobService.query`; update the route's `ApiOperation` summary; if Swagger does not show both parameters as enum arrays, fix it (done in the contract: the repeated-parameter step became a leading `z.transform`, so the docs show the enum list; `@ApiQuery` was dropped because `cleanupOpenApiDoc` strips its `type`), and extend "Docs list the job routes" in `service.e2e.test.ts` with the two parameters. Verify 2.6 passes and `/docs` lists the parameters
- [x] 2.8 Run the `test-case-reviewer` subagent on job-service unit tests (`src/infra/jobs/job-service.impl.test.ts`), integration tests (`src/infra/jobs/prisma/prisma-job-repository.int.test.ts`) and per-app e2e (`test/e2e/jobs.e2e.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 3. Integration

Owns: `DECISIONS.md`, `README.md` · Depends on: 2 · Parallel with: none

- [x] 3.1 Note in `DECISIONS.md` the filter form (repeated parameters, AND between filters, OR within one, `total` over matching jobs) and the offset-paging trade-off with cursor paging planned for milestone 7; if `README.md` shows the job query, add a filter example. Verify the text matches decisions.md
- [x] 3.2 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`) and verify they all pass
