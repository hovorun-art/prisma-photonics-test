# Design

## Context

job-service is type-generic since `webhook-job`: `CreateJobRequest`, `Job` and `JOB_RESULT_SCHEMAS`
in `packages/contracts/src/jobs/job.ts` drive submit validation (`ZodValidationPipe` on the
controller), OpenAPI, result checks in `JobServiceImpl.requireValidResult` and row mapping in
`PrismaJobRepository` (`Job.parse`). The type is stored in the Postgres enum `job_type`
(`email`, `webhook`). So a new type is mostly a contract and an enum change. The one rule a schema
cannot express is the departure-day check, because it needs job-service's clock; `JobServiceImpl`
already receives `Clock`.

The job-ui and job-execution-service already compile against the shared `JobType`:
`JobPresenter.details` switches over `job.type` exhaustively, the locale `jobTypes` map holds one
label per type, and `JobHandlers` is a `Partial<Record<JobType, JobHandler>>`.

## Goals / Non-Goals

**Goals:**
- Transit payload, report schema and the airport list in the shared contracts, reused by the later
  worker (`flight-transit-job-execution`) and map (`flight-transit-map`) changes.
- The departure-day rule in job-service, tested with a mocked clock.
- The same test levels as webhook: contract unit tests, repository integration test, per-app e2e for
  the public and internal routes.

**Non-Goals:**
- A transit handler in job-execution-service: until it exists, a queued transit job fails as
  `UNSUPPORTED_JOB_TYPE` after its attempts (existing behaviour).
- Any transit UI beyond the type label and an empty Details cell.
- Checking that a report matches its payload (same airports, same date).

## Decisions

**Airport list** (`packages/contracts/src/jobs/airports.ts`): `Airport = z.object({ iata, name,
city, country, lat, lon, timeZone })` and `AIRPORTS` as a `const` array of about 50 hubs (Europe,
Asia, Middle East, Africa, North and South America, Oceania; includes `LHR` and `JFK`), with
`AIRPORT_CODES` derived from it. Data, not code, so it stays in contracts where job-service, the
worker and job-ui can all read it. Alternative: a JSON file loaded at runtime. Rejected: a typed
`const` array gives the codes as a literal union and needs no loader in the browser.

**Transit payload** (`job.ts`):
- `AirportCode = z.enum(AIRPORT_CODES)`. One check covers "three upper-case letters" and "in the
  list": `lhr`, `LH` and `XXX` all fail with an issue on that field, and OpenAPI lists the allowed
  codes. Alternative: a `^[A-Z]{3}$` regex plus a membership refine, giving two different messages.
  Rejected: the spec only needs an issue per field, and one enum is simpler and self-documenting.
- `departureDate: z.iso.date()`: checks the `YYYY-MM-DD` form and real calendar dates (Zod 4 rejects
  `2026-02-30` and `2025-02-29`; checked against the installed version).
- `FlightTransitJobPayload = z.object({ origin, destination, departureDate }).refine(origin !==
  destination, { path: ['destination'] })`. The refine runs only when the object shape passes, so a
  missing field reports only the missing-field issues.

**Transit report** (`FlightTransitJobResult`): `flight: string`, `aircraft { model, registration }`,
`origin` / `destination` as `TransitAirport { iata, name, city, timeZone, lat, lon }`, `departureAt`
and `arrivalAt` as top-level ISO timestamps (one per flight, not per airport), `distanceKm`,
`durationMin`, `cruiseAltitudeFt` as non-negative numbers, `path` as an array (min 2) of
`[lat, lon]` tuples, `waypoints` (min 2) of `{ name, at, lat, lon, altitudeFt, groundSpeedKmh,
distanceFlownKm }`. Shared `Latitude` (`[-90, 90]`) and `Longitude` (`[-180, 180]`) schemas are
used by the airport list and the report. `TransitAirport.iata` is a plain three-letter string, not
`AirportCode`, because job-service does not check the report against the bundled list.

**Union**: `JobType` gains `'flight-transit'`; `FlightTransitJob`, `CreateFlightTransitJobRequest`
and a `JOB_RESULT_SCHEMAS['flight-transit']` entry are added; `Job` and `CreateJobRequest` gain the
branch; the barrel (`jobs/index.ts`) exports the new names.

**Departure-day rule** (job-service): `JobServiceImpl.create` calls a private
`requireDepartureDayNotOver` for `flight-transit` jobs before storing. It compares `departureDate`
with the UTC date of `clock.now()` (`toISOString().slice(0, 10)`; ISO dates compare as strings) and
throws a new `InvalidJobPayloadError` (code `VALIDATION_FAILED`, `details.issues` with path
`['payload', 'departureDate']`), the counterpart of `InvalidJobResultError`. The filter already maps
`VALIDATION_FAILED` to 400, so no new error code. Alternatives: a Zod refine reading `new Date()`
in contracts (rejected: contracts stay free of time, and tests would need real time); a separate
`JobSubmissionPolicy` port per type (rejected for now: one rule does not justify a port; revisit
when a second type gets a clock rule, e.g. scheduled jobs' `runAt`).

**Database**: `enum JobType { email webhook flight_transit @map("flight-transit") }` (Prisma enum
names cannot contain `-`), migration `ALTER TYPE "job_type" ADD VALUE 'flight-transit'`, regenerate
the client. `PrismaJobRepository` passes `type` through unchanged today (`type: job.type`, `type:
row.type`), but Prisma's client uses the enum *name* (`flight_transit`), so the repository gains a
private two-way mapping between the contract value and the Prisma name (identity for `email` and
`webhook`). Alternative: rename the contract value to `flight_transit`. Rejected: the API name is
decided as `flight-transit`.

**job-ui**: `en.jobTypes['flight-transit'] = 'flight transit'` and a `'flight-transit'` case in
`JobPresenter.details` returning empty text; a presenter unit test for it. The job-type picker and
the "Aircraft transit" card stay as they are.

**Test data**: e2e and integration tests compute departure dates from the mocked/real clock
(`today`, `today + n days`), never fixed future dates, so they do not expire. The e2e harness's
`seed` gains a valid transit payload for `type: 'flight-transit'`, and a well-formed report fixture
lives in the test file that uses it.

**Module boundaries for the tasks**: group 1 owns the contracts; group 2 owns job-service; group 3
owns job-ui. Groups 2 and 3 depend on group 1 and touch disjoint files, so they could run in
parallel. Group 4 is integration (DECISIONS.md, roadmap, full checks).

## Risks / Trade-offs

- [A 50-value enum makes the OpenAPI document and error messages long] → acceptable; it documents the
  allowed codes for API clients.
- [`refine` on the payload object turns it into a schema with effects inside a discriminated
  union] → Zod 4 keeps the `type` discriminator on the outer object, so this is fine; the contract
  tests cover submit through `CreateJobRequest`, not only the payload schema.
- [Submit is checked against UTC, so a client late in its local evening may already be "tomorrow" in
  UTC, or still "yesterday"] → decided behaviour; the error points at `payload.departureDate`.
- [Transit jobs queued before the handler exists end `failed` with `UNSUPPORTED_JOB_TYPE`] → out of
  scope by decision; `flight-transit-job-execution` adds the handler.
- [`ALTER TYPE ... ADD VALUE` cannot be undone by a down migration] → as for webhook: rollback is a
  new migration; the unused value is harmless.

## Migration Plan

The compose `migrate` one-shot applies the new migration before job-service starts; existing rows
are untouched.
