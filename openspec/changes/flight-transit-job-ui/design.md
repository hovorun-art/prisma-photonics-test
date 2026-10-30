# Design

## Context

See proposal.md for the motivation and `specs/job-ui/spec.md` for the behaviour. Today:

- The submit page switches forms through one `JobFormDraft<Values, Field>` per type
  (`ZodEmailJobDraft`, `ZodWebhookJobDraft`), each with its own form values, schema, field messages,
  API issue mapping and request preview; `JobTypePicker` shows Aircraft transit inside `ComingSoon`.
- `JobPresenter.details` returns an empty text for transit jobs.
- `JobPage` renders one layout for every job.
- The transit contract (`FlightTransitJobPayload`, `FlightTransitJobResult`, `AIRPORTS`) is in
  `packages/contracts`; job-service checks the departure day against UTC.
- job-ui's Playwright suite (`test/e2e/jobs.spec.ts`) runs the built app against a job-service
  mocked with `page.route`, without network.
- Nothing produces completed transit jobs yet (`flight-transit-job-execution` is a later change), so
  every report test runs on fixture jobs.

## Goals / Non-Goals

**Goals:**
- Add the transit form and the report through the same seams the email and webhook types use
  (`JobFormDraft`, `JobPresentation`, the job page), so a fourth type follows the same path.
- Keep all report arithmetic and formatting (tiles, coordinates, local times, flight levels, flown
  path, aircraft bearing, antimeridian handling) in framework-free classes with unit tests; React
  components only lay out what they return.

**Non-Goals:**
- No backend or contract change; no worker.
- No offline tiles or own tile server; the tile source is only configurable.

## Decisions

### Module boundaries (one stage, one commit each)

| Area | Folder | Contents |
|---|---|---|
| Foundation | `package.json`, `src/config/`, `src/locales/en.ts`, `src/components/ui/{command,popover}.tsx`, `features/jobs/testing/job-fixtures.ts` | dependencies, config values, every new string, shadcn primitives, transit fixtures |
| Transit form | `features/jobs/model/` (`transit-form-values.ts`, `zod-transit-job-draft.ts`), `features/jobs/hooks/use-transit-job-draft.ts`, `features/jobs/submit/` (`airport-combobox.tsx`, `transit-payload-fields.tsx`, picker, page) | the third `JobFormDraft` and its fields |
| Report model | `features/transit-map/model/` | `TransitReportPresentation` (interface) + `IntlTransitReportPresenter`; `RouteGeometry` (interface) + `GreatCircleRouteGeometry`; plus the transit branch of `JobPresenter.details` |
| Report page | `features/transit-map/` (`transit-report.tsx`, `transit-map.tsx`, `waypoint-strip.tsx`, `waypoint-card.tsx`, report cards), `features/jobs/details/job-page.tsx` | components and the switch on the job page |

`features/transit-map` uses `features/jobs` only through its exported components and hooks
(`JobHeader` pieces, `JsonCard`, `CopyButton`, `DeleteJobDialog`, `useJobPresenter`), never the
reverse except `JobPage` rendering `TransitReport` through the feature's `index.ts`.

### Transit form

- `ZodTransitJobDraft implements JobFormDraft<TransitFormValues, TransitFormField>` with
  `d: { clock: Clock }` (kernel `Clock`, `SystemClock` in the hook). Values:
  `{ origin: AirportCode | '', destination: AirportCode | '', departureDate: string, priority, maxAttempts }`;
  fields `payload.origin`, `payload.destination`, `payload.departureDate`, `priority`,
  `maxAttempts` (API issue paths, as for webhook).
- `emptyValues` sets `departureDate` to `clock.now()` formatted as the UTC `YYYY-MM-DD`. The schema
  is `CreateFlightTransitJobRequest` plus a refinement "date ≥ today in UTC" on the same clock, so the
  form rejects what job-service would reject. The "different airports" issue comes from the shared
  payload refinement on `payload.destination`.
- The date stays a native `<input type="date">` (design), with `min` set to today's UTC date.
- Alternative: hand-rolled date check in the component. Rejected: the draft is the single place
  where form rules live and is unit-testable with `vi.setSystemTime`.

### Airport combobox

- shadcn's Combobox pattern: a `Button` trigger in a `Popover` (`radix-ui`), `Command` /
  `CommandInput` / `CommandList` / `CommandEmpty` / `CommandItem` from `cmdk`.
- Filtering: `cmdk`'s own fuzzy filter is turned off (`shouldFilter={false}`); the component filters
  `AIRPORTS` itself by a case-insensitive substring of code, name, city and country, which is what
  the spec promises (fuzzy matching would show unrelated hubs for `jfk`). The matcher is a small
  class `AirportSearch` in `features/jobs/model/` with unit tests.
- Integrated with react-hook-form through `Controller`; the trigger carries the field's
  `aria-invalid` and the error id like the other inputs.

### List Details

`JobPresenter.details` gets the transit branch: `"<origin> → <destination> · <d MMM>"` from the
payload date (formatted in UTC, the date is a calendar day), `"<flight> · <n,nnn> km"` when
completed (`Intl.NumberFormat('en-GB')`, rounded km).

### Report model

- `IntlTransitReportPresenter implements TransitReportPresentation`: `tiles(result)`,
  `airportCard(airport, at)` (coordinates `51.4700° N, 0.4543° W` to 4 decimals; UTC time
  `28 Oct 2026, 10:35 UTC`; local time via `Intl.DateTimeFormat('en-US', { timeZone, hour, minute,
  hourCycle: 'h23', timeZoneName: 'short' })` giving `10:35 GMT` / `14:20 EDT`), `waypointCard`
  (altitude `Ground` at 0 ft else `FL` + round(ft/100) zero-padded to 3; flown / left from
  `distanceFlownKm` and `distanceKm`), `title`, `subtitle`.
- Avg ground speed = `distanceKm / (durationMin / 60)`, rounded; duration `"<h>h <m>m"`.
- `GreatCircleRouteGeometry implements RouteGeometry`: `unwrap(path)` shifts each longitude by
  ±360° so consecutive points differ by at most 180° (Leaflet then draws the short way across the
  antimeridian; waypoints and airports are shifted onto the same unwrapped copy); `flownPath(path,
  waypoint)` returns the path up to the path point nearest the selected waypoint plus the waypoint
  itself; `bearing(path, waypoint)` gives the aircraft icon's rotation from the neighbouring path
  points.
- Alternative: `leaflet.antimeridian` or `@turf/*`. Not proposed: the two needed operations are a
  few lines each and already covered by unit tests; a library would need the user's choice, and this
  is domain arithmetic rather than generic tooling.

### Map

- `react-leaflet` `MapContainer` with `TileLayer` (URL and attribution from `UiConfig`:
  `mapTileUrl`, `mapTileAttribution`), `bounds` = the unwrapped path's bounds with padding, default
  zoom control. `Polyline`s: whole path dashed grey, flown path solid accent (`#1F3FC4`).
- Airport labels, waypoint markers and the aircraft use `L.divIcon` with our own markup and classes
  (no default Leaflet marker images, which break under Vite). Waypoint markers are keyboard-focusable
  (`keyboard: true`) and get `aria-label` "<name>, <time>"; `mouseover`, `focus` and `click` select
  the waypoint.
- The waypoint card and the "Flown / Remaining" legend are absolutely positioned React elements
  over the map (as in the design), not Leaflet popups, so they are plain DOM for tests and styles.
- The waypoint strip is a row of `aria-pressed` buttons under the map; the selected index is
  `useState` in `TransitReport`, starting at 0 (departure).
- Leaflet's CSS is imported once in `transit-map.tsx`.

### Report page

- `JobPage` renders `<TransitReport job={job} />` when `job.type === 'flight-transit' &&
  job.status === 'completed' && job.result`; otherwise the existing layout. Polling, loading,
  not-found and the breadcrumb stay in `JobPage`, so the switch on completion happens on the next
  poll without extra code.
- Header: the title, badges and buttons; "Copy as cURL" and "Delete job" reuse the existing
  components; "Run again" is wrapped in `ComingSoon`. "Download JSON" creates a `Blob` of
  `JSON.stringify(result, null, 2)` and clicks a temporary `<a download="transit-<id>.json">`.
- Cards: Origin, Destination, Aircraft, Job (priority, attempts, created, started, completed via
  `JobPresenter`), Result (`JsonCard` with the subtitle "result · <n> path points").

### Config and strings

- `UiConfig` gains `mapTileUrl` (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) and
  `mapTileAttribution` (`&copy; OpenStreetMap contributors`).
- Every new string goes into `locales/en.ts` in group 1 (`submit.types.transit`, `submit.transit.*`,
  `details.transitWaiting/Completed`, `report.*`).

### Tests

- Unit: `zod-transit-job-draft.test.ts` (fake timers for "today"), `airport-search.test.ts`,
  `job-presenter.test.ts` (transit Details), `intl-transit-report-presenter.test.ts`,
  `great-circle-route-geometry.test.ts` (antimeridian, flown path, bearing).
- Component (Vitest + Testing Library, jsdom): `submit-job-page.test.tsx` (transit scenarios,
  combobox), `jobs-list-page.test.tsx` (transit Details), `job-page.test.tsx` (switch to the report,
  non-completed transit jobs), `transit-report.test.tsx` (header, tiles, cards, download, waypoint
  selection through strip and markers, Run again disabled).
- job-ui Playwright (`test/e2e/transit.spec.ts`): the report of a fixture job in a real browser:
  path and markers drawn, hover on a marker shows its card, an antimeridian route renders as one
  short line; tile requests are answered by `page.route` with a blank PNG, so no network is needed.
- Fixtures: `transitJob()` and a Pacific `transitJob()` variant in `testing/job-fixtures.ts`, ids
  from `randomUUID()`.

## Risks / Trade-offs

- [Leaflet in jsdom has no layout: zero-size map, `fitBounds` may misbehave] → component tests
  assert on our own markup (markers, strip, card, legend) and stub nothing in Leaflet; geometry that
  needs a real layout (line drawn, short way across 180°) is asserted in Playwright.
- [OSM tile usage policy: public tiles are for light use and need attribution] → attribution shown;
  the tile URL is config, so a deployment can switch servers; tests never hit the network.
- [Completed transit jobs cannot be produced until the worker exists] → all report tests use
  fixtures that pass `FlightTransitJobResult`; the system e2e is added with the worker change.
- [Local time-zone abbreviations depend on the browser's ICU data (e.g. `GMT+1` instead of `BST`)]
  → tests assert zones whose names are stable in Node and Chromium (`GMT`, `EDT`); the value is
  still correct where the abbreviation differs.
- [`cmdk` adds a dependency for one field] → the user's choice; it also brings the shadcn Command
  primitive for later search features.

## Migration Plan

UI-only change, no data or API migration. Rollback is reverting the merge.
