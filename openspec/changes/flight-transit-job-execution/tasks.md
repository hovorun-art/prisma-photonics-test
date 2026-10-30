# Tasks

## Plan

1 → 2 → 3 → 4. Groups 2 (generator) and 3 (handler) meet only at the `TransitReportGenerator` port
from group 1, so they could run in parallel; sequential by default. Group 4 is integration and not
parallel. Each group ends with its own commit (with the user's approval), one commit per group.

All paths below are under `apps/job-execution-service/src/` unless stated otherwise.

## 1. Foundations: port, error code, config, dependencies

Owns: `domain/flight-transit/transit-report-generator.ts`, `domain/flight-transit/flight-transit-job-error-codes.ts`, `domain/config/execution-config.ts`, `infra/config/zod-execution-config-parser.ts`, `infra/config/zod-execution-config-parser.test.ts`, `apps/job-execution-service/package.json`, `package-lock.json` (repo root), `.env.example` (repo root) · Depends on: none · Parallel with: none

- [x] 1.1 Add `@date-fns/tz` and `@turf/distance`, `@turf/along`, `@turf/helpers` to `apps/job-execution-service` with `npm install -w apps/job-execution-service`; verify `npm run typecheck` passes
- [x] 1.2 Add the `TransitReportGenerator` port with its Request/Response types and `TRANSIT_REPORT_GENERATOR` token, and `FLIGHT_TRANSIT_JOB_ERROR_CODES` (design.md "Two classes, one port"); verify `npm run typecheck` passes
- [x] 1.3 Write failing parser tests: the eight `FLIGHT_TRANSIT_*` settings default to the values in design.md "Config", are read when set, and a failure rate outside [0, 1], a negative wait, fewer than 2 path points or negative cruise waypoints are rejected; run `npm run test:unit -w apps/job-execution-service` and see them fail
- [x] 1.4 Add the eight settings to `ExecutionConfig` and `ZodExecutionConfigParser` (defaults only in `DEFAULTS`) and list them commented out in `.env.example`; verify the tests from 1.3 pass
- [x] 1.5 Run the `test-case-reviewer` subagent on `apps/job-execution-service/src/infra/config/zod-execution-config-parser.test.ts`; add the missing cases it reports or note why they belong elsewhere
- [x] 1.6 Show the group's diff and commit message to the user and commit it with their approval (`feat(job-execution-service): ...`)

## 2. Transit report generator

Owns: `infra/flight-transit/flight-data.ts`, `infra/flight-transit/turf-transit-report-generator.ts`, `infra/flight-transit/turf-transit-report-generator.test.ts` · Depends on: 1 · Parallel with: 3

- [ ] 2.1 Add the constant tables in `flight-data.ts` (aircraft models with class, cruise speed and altitude; airline codes; registration prefixes) per design.md; verify `npm run typecheck` passes
- [ ] 2.2 Write failing tests in `turf-transit-report-generator.test.ts` (mocked `Random`, `...Once` stubs in the draw order of design.md, defaults of design.md "Config" as params), each named after its scenario: "Report airports are the payload's airports", "Report distance is the great-circle distance" (expected value from `@turf/distance` in radians × 6371 for LHR–JFK), "Path runs from origin to destination", "Path across the antimeridian stays in range" (NRT–LAX), "Departure lies within the date in the origin's time zone" (SYD, 2026-11-02, a slot whose UTC date is 2026-11-01), "Departure is on a whole five minutes", "Arrival is departure plus duration", "Short-haul flight gets a narrow-body aircraft" (LHR–CDG), "Long-haul flight gets a wide-body aircraft" (LHR–JFK), "Flight number and registration have their formats", "Long flight waypoints in phase order", "Long flight altitude and speed profile", "Short flight has a single peak waypoint" (LHR–CDG), "Waypoint distance and time run from departure to arrival", "Each attempt generates a new report" (two calls with different draws give different flight numbers and departure times); each report also passes `FlightTransitJobResult.parse`; see them fail
- [ ] 2.3 Implement `TurfTransitReportGenerator` (design.md "Geo math", "Departure time", "Profile and duration"); verify the tests from 2.2 pass
- [ ] 2.4 Run the `test-case-reviewer` subagent on `apps/job-execution-service/src/infra/flight-transit/turf-transit-report-generator.test.ts`; add the missing cases it reports or note why they belong elsewhere
- [ ] 2.5 Show the group's diff and commit message to the user and commit it with their approval

## 3. Flight transit job handler

Owns: `infra/flight-transit/flight-transit-job-handler.ts`, `infra/flight-transit/flight-transit-job-handler.test.ts` · Depends on: 1 · Parallel with: 2

- [ ] 3.1 Write failing tests in `flight-transit-job-handler.test.ts` (mocked `Random`, `Sleeper`, `TransitReportGenerator` and logger), named "Flight transit job takes the configured time" (sleeps `generateMs` with the job's signal and does not finish before the sleep resolves), "Transit failure rate zero never fails", "Transit failure rate one always fails", "Failed transit attempt carries the route" (LHR–JFK: code `FLIGHT_TRANSIT_DATA_UNAVAILABLE`, message `Flight data for LHR-JFK is unavailable`, details `{ origin, destination }`, the generator not called), "Generated flight is logged" (one info line with `jobId`, `attempt`, `flight`, `distanceKm`, `durationMin`); see them fail
- [ ] 3.2 Implement `FlightTransitJobHandler` (design.md "Two classes, one port"); verify the tests from 3.1 pass
- [ ] 3.3 Write a failing test in `infra/execution/job-execution.impl.test.ts` only if "Failed transit attempt is logged as a warning" is not already covered by its generic failed-outcome warn test (job id, attempt, instance id, code); otherwise note the covering test name in this task
- [ ] 3.4 Run the `test-case-reviewer` subagent on `apps/job-execution-service/src/infra/flight-transit/flight-transit-job-handler.test.ts`; add the missing cases it reports or note why they belong elsewhere
- [ ] 3.5 Show the group's diff and commit message to the user and commit it with their approval

## 4. Integration

Owns: `app/execution/execution.module.ts`, `DECISIONS.md` (repo root) · Depends on: 1, 2, 3 · Parallel with: none

- [ ] 4.1 Register `'flight-transit': new FlightTransitJobHandler(...)` in `JOB_HANDLERS` with a `TurfTransitReportGenerator` built from the config, and a `Logger('FlightTransit')`; verify `npm run build` succeeds
- [ ] 4.2 Update `DECISIONS.md`: how the transit report is generated (great-circle math with turf on a 6371 km sphere, departure in the origin's local time, climb-cruise-descent profile, aircraft by distance class, the short-flight peak), the simulated wait and failure, and the library choices with their numbers and reasons (`@date-fns/tz` over `temporal-polyfill` and `luxon`; `@turf/distance` + `@turf/along` over `@turf/great-circle` and `geolib`); replace any note that queued transit jobs fail as `UNSUPPORTED_JOB_TYPE`
- [ ] 4.3 Run the full checks (`CHECK_CMDS` in `.claude/flow.conf`: typecheck, lint, test) and verify they pass
- [ ] 4.4 Show the group's diff and commit message to the user and commit it with their approval

## Workflow follow-up

- Run the `change-verifier` subagent and get PASS, then `/archive flight-transit-job-execution` on this branch.
