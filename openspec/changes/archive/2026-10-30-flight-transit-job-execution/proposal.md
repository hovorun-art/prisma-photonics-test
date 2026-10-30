# Proposal

## Why

The `flight-transit-job` change taught job-service the `flight-transit` type: clients can submit,
store and read transit jobs, and the internal API accepts a well-formed transit report. Nothing
generates that report yet: job-execution-service has no transit handler, so every queued transit
job fails with `UNSUPPORTED_JOB_TYPE` after its attempts. The task asks for a report of an aircraft
transit between two airports, with dates and geo locations, which the UI later draws on a map
(`flight-transit-map`). This change makes transit jobs run and complete with that report.

## What Changes

- job-execution-service gains a flight transit handler in its `flight-transit` domain module: for
  the job's origin, destination and departure date it generates a report with the flight, the
  aircraft, both airports from the bundled list, departure and arrival times, distance, duration,
  cruise altitude, the great-circle path and waypoints along it, in the report shape agreed in
  `flight-transit-job`.
- Generated values that are not determined by the airports (flight number, aircraft, time of day,
  speeds) come from injected randomness, so the handler is deterministic under test.
- A completed transit job stores the report through the existing internal API; job-service already
  validates it.
- No contract or job-service change: the payload and report shapes exist already.
- Out of scope: the map page (`flight-transit-map`), real flight data from an external API
  (`flight-transit-real-data`), the submit form in job-ui.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `flight-transit-job`: gains how a transit job runs: what the generated report contains and how it
  relates to the job's payload (its airports, its departure date, a path between them).

## Impact

- `apps/job-execution-service`: a transit `JobHandler` under `infra/flight-transit/` (and its domain
  types under `domain/flight-transit/`), registered in the execution module's handler map; possibly
  new settings in `ExecutionConfig` and its parser.
- `DECISIONS.md`: how the report is generated (great-circle math, made-up aircraft data) and why.
- `docs/roadmap/03-all-job-types.md`: none expected (the row exists).
