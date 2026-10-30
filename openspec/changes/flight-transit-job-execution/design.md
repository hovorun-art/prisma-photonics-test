# Design

## Context

job-execution-service runs a job through the `JobHandler` registered for its type in the
`JOB_HANDLERS` map (`app/execution/execution.module.ts`); a type without a handler fails as
`UNSUPPORTED_JOB_TYPE`, which is today's path for `flight-transit`. `JobExecutionImpl` already logs
"Job started", "Job completed" and, at warn, "Job failed" with the error's `code` and `details`;
every Nest `Logger` line carries the instance id from the root logger. Handlers get `Random` and
`Sleeper` through `d` and their settings through `p` (see `WebhookJobHandler`). The payload
(`FlightTransitJobPayload`), the report (`FlightTransitJobResult`) and the airport list
(`AIRPORTS`) are in `packages/contracts`; job-service checks the report's shape on completion.

## Goals / Non-Goals

**Goals:**
- Report generation split from the simulated wait and failure, so each is unit-tested on its own
  with `mockDeep<Random>()` and no real time.
- All tunable values in `ExecutionConfig` with defaults in the config parser.

**Non-Goals:**
- Splitting the path at the antimeridian for drawing: the path keeps every longitude in
  [-180, 180]; drawing it without a line across the whole map is `flight-transit-map`'s job.
- A seeded random source (every attempt draws anew, by decision).
- Contract, job-service or job-ui changes.

## Decisions

**Two classes, one port between them.**
- `domain/flight-transit/transit-report-generator.ts`: `TransitReportGenerator.generate(req:
  GenerateTransitReportGeneratorRequest { payload: FlightTransitJobPayload }):
  GenerateTransitReportGeneratorResponse { report: FlightTransitJobResult }` and the token
  `TRANSIT_REPORT_GENERATOR`. Synchronous; its only dependency is `Random`.
- `domain/flight-transit/flight-transit-job-error-codes.ts`: `FLIGHT_TRANSIT_JOB_ERROR_CODES =
  { dataUnavailable: 'FLIGHT_TRANSIT_DATA_UNAVAILABLE' }`, like `WEBHOOK_JOB_ERROR_CODES` (a job's
  stored error, not an API error, so not in `ERROR_CODES`).
- `infra/flight-transit/flight-transit-job-handler.ts`: `FlightTransitJobHandler implements
  JobHandler`, `d: { random, sleeper, reports: TransitReportGenerator, logger }`, `p: { generateMs,
  failureRate }`. `run`: sleep `generateMs` with the job's signal; draw `random.next()` once; below
  `failureRate` return `failed` with `FLIGHT_TRANSIT_DATA_UNAVAILABLE`, message `Flight data for
  ${origin}-${destination} is unavailable`, details `{ origin, destination }`; otherwise generate,
  log `Transit report generated` with `{ jobId, attempt, flight, distanceKm, durationMin }` and
  return `completed`. The warn line for a failure is the existing "Job failed" line of
  `JobExecutionImpl` (job id, attempt, instance id, code); the handler does not log it twice.
- `infra/flight-transit/turf-transit-report-generator.ts`: `TurfTransitReportGenerator implements
  TransitReportGenerator`, `d: { random }`, `p: { pathPoints, cruiseWaypoints, longHaulKm, climbKm,
  descentKm, taxiSpeedKmh }`.
- Alternative: one handler class doing everything. Rejected: the wait and failure tests would have
  to stub a dozen generation draws, and the generation tests would need the sleeper.

**Generated-data tables** (`infra/flight-transit/flight-data.ts`, constants only):
- Aircraft models with class, cruise ground speed and cruise altitude: narrow-body A320neo
  (830 km/h, 37 000 ft), B737 MAX (840 km/h, 37 000 ft); wide-body A350-900 (905 km/h, 39 000 ft),
  B787-9 (905 km/h, 40 000 ft), B777-300ER (905 km/h, 39 000 ft).
- Airline codes (two characters): BA, AF, LH, KL, IB, AZ, TK, EK, QR, SQ, CX, NH, JL, QF, NZ, AA,
  DL, UA, AC, LA, ET, SA.
- Registration prefixes (letters only, so the format is "prefix-four letters"): G, F, D, EI, PH, OE,
  HB, C, VH, ZK, ZS, CC.
- Alternative: models per airline. Rejected: not decided, no user-visible gain.

**Draw order** (fixed, so tests stub `Random` with `...Once` calls in this order): handler:
`next()` for the failure. Generator: `int(0..287)` departure slot (×5 minutes), `int` airline
index, `int(1..9999)` flight number, `int` model index within the class, `int` registration prefix
index, four `int(0..25)` letters.

**Geo math** (`@turf/distance`, `@turf/along`; chosen by the user, see decisions.md):
- Distance: `distance(from, to, { units: 'radians' }) × 6371`, rounded to whole km. Radians keep
  the spec's 6371 km radius; turf's own km use 6371.0088 km.
- Points along the route: `along(lineString([from, to]), d / 6371, { units: 'radians' })`. On a
  two-vertex line `along` goes from the start along the initial bearing, which is the great circle.
- Path: `pathPoints` points at `i × D / (pathPoints − 1)`; the first and last are the airports'
  bundled coordinates exactly; the rest rounded to 5 decimals; longitudes wrapped into [-180, 180]
  by a private `wrapLongitude` (turf can return e.g. 190° on a route east of Tokyo). Turf is
  `[lon, lat]`; the report is `[lat, lon]`.
- Alternative: hand-written haversine and slerp. Rejected by the library rule in CLAUDE.md.

**Departure time** (`@date-fns/tz`): `TZDate.tz(origin.timeZone, y, m − 1, d, 0, slot × 5)`, then
the ISO string of its instant in UTC. A slot in a spring-forward gap is moved forward by the
library and stays on the same local date on a whole five minutes; the test for the SYD scenario
pins a slot near local midnight, where the UTC date differs.

**Profile and duration** (per waypoint and for `durationMin`):
- `D ≥ climbKm + descentKm`: climb from (0 ft, `taxiSpeedKmh`) to (cruise altitude, cruise speed)
  over `climbKm`, cruise, descend over `descentKm`. Waypoints: Departure at 0, Top of climb at
  `climbKm`, `Cruise 1..N` at `climbKm + k × C / (N + 1)` for the cruise length `C`, Top of descent
  at `D − descentKm`, Arrival at `D`.
- `D < climbKm + descentKm`: the peak is at `D / 2`; its altitude and speed are the cruise values
  scaled by `D / (climbKm + descentKm)` (below cruise, above 0; speed not below taxi). Waypoints:
  Departure, `Peak`, Arrival.
- Time: speed changes linearly on climb and descent, so each takes `length / average speed`; cruise
  takes `C / cruise speed`. `durationMin = round(total)`; `arrivalAt = departureAt + durationMin`.
  Each waypoint's `at` is `departureAt + durationMin × (its raw time / raw total)`, rounded to whole
  seconds, so the last equals `arrivalAt` exactly. `distanceFlownKm` in whole km (the last is
  `distanceKm`), altitude in whole feet, speed in whole km/h.
- Alternative: a fixed climb and descent time allowance. Rejected: waypoint times would not match
  their speeds.

**Config** (`ExecutionConfig`, `ZodExecutionConfigParser`, defaults only in the parser):
`FLIGHT_TRANSIT_GENERATE_MS` (2000), `FLIGHT_TRANSIT_FAILURE_RATE` (0.1, in [0, 1]),
`FLIGHT_TRANSIT_PATH_POINTS` (64, ≥ 2), `FLIGHT_TRANSIT_CRUISE_WAYPOINTS` (4, ≥ 0),
`FLIGHT_TRANSIT_LONG_HAUL_KM` (4000), `FLIGHT_TRANSIT_CLIMB_KM` (200), `FLIGHT_TRANSIT_DESCENT_KM`
(250), `FLIGHT_TRANSIT_TAXI_SPEED_KMH` (30). Listed, commented out, in `.env.example`.

**Module boundaries for the tasks**: group 1 owns the shared foundations (port, error codes,
config, dependencies); group 2 the generator and its data tables; group 3 the handler; group 4 the
wiring, docs and full checks. Groups 2 and 3 meet only at the `TransitReportGenerator` port.

## Risks / Trade-offs

- [`at` values are scaled to the rounded `durationMin`, so speed and time disagree by under a
  minute] → invisible on hover; keeps `arrivalAt` exact.
- [A route crossing the antimeridian jumps from +180 to −180 between two path points] → valid data
  by spec; the map change splits the line.
- [Failure rate 0.1 with 3 attempts fails about 0.1 % of transit jobs for good] → intended, like
  webhook; set the rate to 0 for demos.
- [Many draws per report make tests verbose] → the draw order is fixed above, and each test file
  stubs it through one private helper in the test.

## Migration Plan

New settings have defaults, so existing deployments start unchanged. Transit jobs that already
failed with `UNSUPPORTED_JOB_TYPE` stay failed; a user can retry them with the existing retry action.
