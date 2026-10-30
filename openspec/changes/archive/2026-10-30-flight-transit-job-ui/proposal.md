# Proposal

## Why

job-service accepts aircraft transit jobs (`flight-transit-job`), but job-ui still shows the
Aircraft transit job type disabled, has no form for it and shows nothing transit-specific in the
list or on the job page. The task asks to show aircraft transits on a map, so a user must be able to
submit a transit job from the UI and read its report, route included, there.

## What Changes

- The submit page lets the user choose Aircraft transit and fill in its payload (origin and
  destination airport, departure date) as in the design's SubmitTransit screen; the airports are
  picked from a searchable list of the bundled airports. The request preview and example response
  follow the transit form.
- The jobs list shows a transit summary in the Details column.
- The page of a completed transit job becomes the transit report of the design's TransitReport
  screen: summary tiles, a map of the route with its waypoints and hover details, origin,
  destination and aircraft cards, the result JSON with "Download JSON", and "Run again" shown
  disabled. Transit jobs that wait, run or failed keep the normal job page.
- The Aircraft transit job type is no longer listed among the disabled features.
- This change also takes over the roadmap's `flight-transit-map` change.
- Out of scope: generating the report, which `flight-transit-job-execution` does (merged into
  `master` while this change was built, so transit jobs now complete in a running system).

## Capabilities

### New Capabilities

<!-- None expected; placement of the report requirements is a decision in decisions.md. -->

### Modified Capabilities

- `job-ui`: submitting a transit job, the transit Details cell, the transit report page with its
  map, and Aircraft transit no longer listed among the disabled features.

## Impact

- `apps/job-ui`: submit page (type picker, transit payload form with an airport combobox, request
  preview), list Details column, the job page of completed transit jobs (report and map), locales,
  UI config.
- New job-ui dependencies: `cmdk` (combobox), `leaflet`, `react-leaflet`, `@types/leaflet`.
- Uses the existing transit contract in `packages/contracts` (`FlightTransitJobPayload`,
  `FlightTransitJobResult`, `AIRPORTS`); no API change.
- `docs/roadmap/03-all-job-types.md`: `flight-transit-map` is replaced by this change.
- `DECISIONS.md`: the combobox library choice with its numbers.
- `packages/kernel` and `apps/job-service`: the "departure day not over in UTC" rule moves into one
  shared kernel class used by job-service and job-ui (decided during apply); no behaviour change.
