# Decisions: flight-transit-job

## Decided

- Planned and built in its own worktree (`../prisma-photonics-test-flight-transit-job`) on branch `flight-transit-job`, from `master` (user)
- Scope: job-service only (contracts, validation, storage and API for the transit type); generating the report and the UI come later (user)
- Payload as in the design's SubmitTransit form: `{ origin, destination, departureDate }`, two IATA airport codes and a calendar date `YYYY-MM-DD`; the time of day is generated later by the worker (user, design SubmitTransit)
- The bundled airport list holds about 50 major international hubs (user)
- An airport code not in the bundled list is rejected on submit with 400 `VALIDATION_FAILED` on `payload.origin` / `payload.destination`; the list is shared through `packages/contracts` (user)
- A completed transit job returns the full report of the design's TransitReport page: flight, aircraft (model, registration), origin and destination (IATA, name, city, time zone, coordinates, departure / arrival time), distance, duration, cruise altitude, the great-circle path and the waypoints with their hover details (time, position, altitude, ground speed, distance flown) (user, design TransitReport)
- Origin and destination must differ; the same airport twice answers 400 `VALIDATION_FAILED` on `payload.destination` (user)
- The departure date is accepted while that day (in UTC) is not over yet, checked against job-service's current time: today and later pass, yesterday and earlier answer 400 `VALIDATION_FAILED` on `payload.departureDate` (user)
- The job type is named `flight-transit` in the API and in Postgres (user)
- Airport codes are upper case only; `lhr` answers 400 (user)
- Roadmap milestone 3 gains a `flight-transit-job-execution` change (generate the transit report in job-execution-service) between `flight-transit-job` and `flight-transit-map`; `flight-transit-map` then depends on it (user)
- job-ui only compiles with the new type: a type label, nothing transit-specific (the list's Details cell stays empty for transit jobs); the Aircraft transit card stays disabled; no job-ui spec change (user)
- Each bundled airport has IATA code, name, city, country, latitude, longitude and IANA time zone; the ~50 hubs are spread over every inhabited continent and include LHR and JFK from the design (user confirmed assumption)
- An invalid payload (missing field, code not three upper-case letters, a date that is not a real calendar date such as `2026-02-30`) answers 400 `VALIDATION_FAILED` with an issue per field, like the other types (user confirmed assumption)
- Result field names and units: `flight` (string), `aircraft { model, registration }`, `origin` / `destination { iata, name, city, timeZone, lat, lon }` plus `departureAt` / `arrivalAt` (ISO timestamps), `distanceKm`, `durationMin`, `cruiseAltitudeFt`, `path` as `[lat, lon]` pairs, `waypoints[] { name, at, lat, lon, altitudeFt, groundSpeedKmh, distanceFlownKm }` (user confirmed assumption)
- Result rules job-service checks: latitudes in [-90, 90], longitudes in [-180, 180], non-negative numbers, `path` with at least 2 points, at least 2 waypoints (departure and arrival); it does not check that the report matches the payload (same airports, same date) (user confirmed assumption)
- A failed transit attempt uses the shared `JobError` `{ code, message, details }` unchanged; no transit-specific error shape (user confirmed assumption)
- The departure-date "day not over" check runs in job-service (it needs the clock), not in the shared Zod schema; the shared schema checks only the format and the airport list (user confirmed assumption)
- The Prisma `JobType` enum gains `flight_transit` mapped to `flight-transit` in Postgres through a new migration (user confirmed assumption)
- Until `flight-transit-job-execution`, a queued transit job takes job-execution-service's existing "unsupported job type" path (attempt fails, then retries and fails for good); no execution change here (user confirmed assumption)
- Tests: unit tests for the new schemas and the date check, and the job-service per-app e2e (`jobs`, `internal-jobs`) extended with transit scenarios; no system e2e (user confirmed assumption)

## Assumed

- [x] Each bundled airport has IATA code, name, city, country, latitude, longitude and IANA time zone; the ~50 hubs are spread over every inhabited continent and include LHR and JFK from the design - enough for the report's airport cards and local times
- [x] An invalid payload (missing field, code not three upper-case letters, a date that is not a real calendar date such as `2026-02-30`) answers 400 `VALIDATION_FAILED` with an issue per field, like the other types - same error shape for all types
- [x] Result field names and units: `flight` (string), `aircraft { model, registration }`, `origin` / `destination { iata, name, city, timeZone, lat, lon }` plus `departureAt` / `arrivalAt` (ISO timestamps), `distanceKm`, `durationMin`, `cruiseAltitudeFt`, `path` as `[lat, lon]` pairs, `waypoints[] { name, at, lat, lon, altitudeFt, groundSpeedKmh, distanceFlownKm }` - matches the design's sample, with explicit units in the names
- [x] Result rules job-service checks: latitudes in [-90, 90], longitudes in [-180, 180], non-negative numbers, `path` with at least 2 points, at least 2 waypoints (departure and arrival); it does not check that the report matches the payload (same airports, same date) - like webhook, job-service checks the shape, the worker owns the content
- [x] A failed transit attempt uses the shared `JobError` `{ code, message, details }` unchanged; no transit-specific error shape - the worker change picks its codes
- [x] The departure-date "day not over" check runs in job-service (it needs the clock), not in the shared Zod schema; the shared schema checks only the format and the airport list - contracts stay free of time
- [x] The Prisma `JobType` enum gains `flight_transit` mapped to `flight-transit` in Postgres through a new migration - Prisma enum names cannot contain `-`
- [x] Until `flight-transit-job-execution`, a queued transit job takes job-execution-service's existing "unsupported job type" path (attempt fails, then retries and fails for good); no execution change here - the scope stays job-service only
- [x] Tests: unit tests for the new schemas and the date check, and the job-service per-app e2e (`jobs`, `internal-jobs`) extended with transit scenarios; no system e2e - same levels as webhook-job

## Open questions

- [x] Adding `flight-transit` to the shared `JobType` makes the jobs list and job page receive transit jobs. What should job-ui do with them in this change?
