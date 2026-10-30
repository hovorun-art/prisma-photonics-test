# Tasks

## Plan

1 (contracts) → 2 (job-service) and 3 (job-ui) → 4 (integration). Groups 2 and 3 both need group 1's
schemas and touch disjoint files, so they could run in parallel; 4 runs last, alone.

Before the first task: this worktree has no `node_modules`; run `npm install` and
`npm run build:packages` at its root.

## 1. Transit contract and airport list

Owns: `packages/contracts/src/jobs/airports.ts`, `packages/contracts/src/jobs/airports.test.ts`, `packages/contracts/src/jobs/job.ts`, `packages/contracts/src/jobs/job.test.ts`, `packages/contracts/src/jobs/index.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Write a failing test in `airports.test.ts` named "Bundled airports cover the inhabited continents": unique three-letter upper-case codes, non-empty name, city and country, latitude in [-90, 90], longitude in [-180, 180], a time zone `Intl.DateTimeFormat` accepts, `LHR` and `JFK` present, and at least one airport whose time zone starts with each of `Europe/`, `Asia/`, `Africa/`, `America/` in North and in South America (by country), and `Australia/` or `Pacific/`; run `npm run test:unit -w packages/contracts` and see it fail because the module is missing
- [x] 1.2 Add `Latitude`, `Longitude`, `Airport`, `AIRPORTS` (about 50 hubs, design.md "Airport list") and `AIRPORT_CODES` in `airports.ts`; verify the test from 1.1 passes
- [x] 1.3 Write failing submit tests in `job.test.ts` through `CreateJobRequest`, named after the scenarios "Valid flight transit job is accepted", "Unknown airport code" (`XXX`), "Lower-case airport code" (`jfk`), "Same airport twice" (issue on `payload.destination`), "Missing payload fields" (one issue each for `origin`, `destination`, `departureDate`, and no same-airport issue), "Airport code of the wrong form" (`LH`, `LHRX`) and "Departure date is not a calendar date" (`2026-02-30`, `30/10/2026`, a full timestamp), each asserting the issue path; see them fail because `flight-transit` is an unknown type
- [x] 1.4 Write failing tests for `FlightTransitJobResult`: a well-formed report is accepted, and "Transit report does not match" (no `aircraft`, latitude 91, longitude -181, negative `distanceKm`, a one-point `path`, a single waypoint) is rejected; and for `Job` parsing a completed transit job and a failed one with a shared `JobError`
- [x] 1.5 Add `AirportCode`, `FlightTransitJobPayload` (with the origin ≠ destination refine), `TransitAirport`, `FlightTransitJobResult`, `FlightTransitJob`, `CreateFlightTransitJobRequest`; extend `JobType`, `Job`, `CreateJobRequest`, `JOB_RESULT_SCHEMAS` and the barrel (design.md "Transit payload", "Transit report", "Union"); verify the tests from 1.3 and 1.4 pass and `npm run build:packages` succeeds

## 2. job-service accepts, stores and serves transit jobs

Owns: `apps/job-service/prisma/schema.prisma`, `apps/job-service/prisma/migrations/<timestamp>_flight_transit_job_type/`, `apps/job-service/src/infra/prisma/generated/**`, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.ts`, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.int.test.ts`, `apps/job-service/src/domain/jobs/errors/invalid-job-payload.error.ts`, `apps/job-service/src/domain/jobs/errors/invalid-job-payload.error.test.ts`, `apps/job-service/src/domain/jobs/job-service.ts`, `apps/job-service/src/infra/jobs/job-service.impl.ts`, `apps/job-service/src/infra/jobs/job-service.impl.test.ts`, `apps/job-service/test/e2e/job-service-under-test.ts`, `apps/job-service/test/e2e/jobs.e2e.test.ts`, `apps/job-service/test/e2e/internal-jobs.e2e.test.ts` · Depends on: 1 · Parallel with: 3

- [x] 2.1 Write a failing repository integration test: a flight transit job is created and read back with type `flight-transit` and its payload, and it is listed next to an email job; run `npm run test:integration -w apps/job-service` and see it fail on the missing enum value
- [x] 2.2 Add `flight_transit @map("flight-transit")` to the Prisma `JobType` enum, create the migration (`ALTER TYPE "job_type" ADD VALUE 'flight-transit'`), regenerate the client and add the repository's contract ↔ Prisma type mapping (design.md "Database"); verify the test from 2.1 and the existing repository tests pass
- [x] 2.3 Write a failing unit test for `InvalidJobPayloadError` (code `VALIDATION_FAILED`, the shared message, issue paths prefixed with `payload`), then add it next to `InvalidJobResultError`; verify it passes
- [x] 2.4 Write failing `JobServiceImpl` unit tests with a mocked `Clock`: "Departure today is accepted" (clock late in that UTC day, the job is stored and queued) and "Departure yesterday is rejected" (clock early in the next UTC day, `InvalidJobPayloadError` on `payload.departureDate`, nothing stored or queued), plus an email job that is not checked; then add `requireDepartureDayNotOver` (design.md "Departure-day rule") and document the error on `JobService.create`; verify they pass
- [x] 2.5 Give the harness's `seed` a valid transit payload for `type: 'flight-transit'` (departure date from the current date); write per-app e2e tests in `jobs.e2e.test.ts` for "Valid flight transit job is accepted", "Flight transit job is read and listed like any job", "Unknown airport code", "Lower-case airport code", "Same airport twice", "Departure yesterday is rejected" (yesterday's UTC date), "Missing payload fields", "Airport code of the wrong form" and "Departure date is not a calendar date" over HTTP (400 `VALIDATION_FAILED`, issue path, nothing stored, nothing queued); verify they pass
- [x] 2.6 Write e2e tests in `internal-jobs.e2e.test.ts` for "Transit report is stored", "Report for other airports than the payload is stored", "Transit report does not match" (job unchanged) and "Failed transit error is returned as sent"; verify they pass
- [x] 2.7 Run the `test-case-reviewer` subagent on the job-service unit, integration and per-app e2e transit tests; add the missing cases it reports or note why they belong elsewhere

## 3. job-ui knows the new type

Owns: `apps/job-ui/src/locales/en.ts`, `apps/job-ui/src/features/jobs/model/job-presenter.ts`, `apps/job-ui/src/features/jobs/model/job-presenter.test.ts` · Depends on: 1 · Parallel with: 2

- [x] 3.1 Write a failing `JobPresenter` test: a pending and a completed flight transit job have empty Details text; see it fail (and `npm run typecheck -w apps/job-ui` report the missing `flight-transit` label and case)
- [x] 3.2 Add the `flight-transit` label to `en.jobTypes` and the `flight-transit` case in `JobPresenter.details` (design.md "job-ui"); verify the test passes and `npm run typecheck -w apps/job-ui` is clean

## 4. Integration

Owns: `DECISIONS.md`, `docs/roadmap/03-all-job-types.md` · Depends on: 1, 2, 3 · Parallel with: none

- [x] 4.1 Add the `flight-transit-job-execution` row to the roadmap between `flight-transit-job` and `flight-transit-map`, make `flight-transit-map` depend on it, and check the transit airports open question (answered by this change); verify the table renders with the new row
- [x] 4.2 Add `DECISIONS.md` entries: the airport list lives in contracts as a typed constant; the departure-day rule runs in job-service against its clock in UTC (not in the shared schema); job-service checks the report's shape, not that it matches the payload; transit jobs queued before the handler exists fail as `UNSUPPORTED_JOB_TYPE`; verify each entry names its alternative
- [x] 4.3 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`) and verify all pass

## Workflow follow-up

- Run the `change-verifier` subagent and get PASS, then `/archive flight-transit-job` on this branch.
