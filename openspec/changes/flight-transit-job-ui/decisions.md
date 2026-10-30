# Decisions: flight-transit-job-ui

## Decided

- Planned and built in its own worktree (`../prisma-photonics-test-flight-transit-job-ui`) on branch `flight-transit-job-ui`, from `master` (user)
- Scope: the transit submit form, the list Details cell and the full transit report with the map; this change takes over the roadmap's `flight-transit-map` (user)
- The visual design is the user's Claude Design project (artifact `2c72083e-7fe0-4c29-a748-b0672b62866e`), screens SubmitTransit and TransitReport (user)
- Origin and destination are picked from a searchable list (combobox) of the bundled airports; a code outside the list cannot be entered (user)
- The combobox uses `cmdk` (v1.1.1, 2025-08-27, ~46.3M weekly downloads, own types, ESM), as shadcn's Command/Combobox with the Popover from `radix-ui`; chosen over `@headlessui/react` (v2.2.10, ~9.9M weekly), `downshift` (v9.4.0, ~5.8M weekly) and `react-select` (v5.10.2, ~12.5M weekly) (user)
- The map uses Leaflet + react-leaflet with OpenStreetMap tiles, as decided during planning (`leaflet` v1.9.4, ~10.9M weekly; `react-leaflet` v5.0.0, ~5.2M weekly, React 19 peer; `@types/leaflet` v1.9.22) (user, CLAUDE.md)
- The report is the job page (`/jobs/:id`) of a completed transit job, titled "<origin> → <destination>" as in the design; transit jobs that are pending, processing or failed keep the normal job page (user)
- "Download JSON" saves the report; "Run again" is shown disabled with the "Coming soon" tooltip, enabled by a later change (user)
- Implementation: each stage (task group) of the apply is its own commit, made with the user's approval (user)
- All requirements go into the existing `job-ui` capability (as webhook-job-ui did); no new capability (user confirmed assumption)
- Choosing Aircraft transit shows `/jobs/new?type=flight-transit`; opening it directly selects the type, Back returns to the previous type, Priority and Max attempts are kept on switching (user confirmed assumption)
- "2. Payload" shows Origin airport, Destination airport and Departure date in one row (as in the design), both airports empty at first and the date set to today's UTC date; the note reads "Pick two bundled airports. The worker generates the flight, its great-circle path and waypoints." (user confirmed assumption)
- An airport option reads "<IATA> · <name>, <city>" and the search matches code, name, city and country, case-insensitive; the closed field shows the chosen code and name; "No airport found" when nothing matches (user confirmed assumption)
- The form checks the API's rules before sending: both airports required, the two must differ (error under Destination), the date must be a real date not before today's UTC date (error under Departure date); API `VALIDATION_FAILED` issues map to the fields like the other types (user confirmed assumption)
- The transit Details cell shows "<origin> → <destination> · <departure date, e.g. 28 Oct>" while the job waits or runs, "<flight> · <distance> km" when completed, and the error message when failed (user confirmed assumption)
- The report header: title "<origin> → <destination>", status and type badges, subtitle "Aircraft transit report · <full id> · generated in <total time>"; the design's worker name is left out (not in the API yet); the existing "Copy as cURL" and "Delete job" buttons stay next to "Download JSON" and "Run again" (user confirmed assumption)
- Summary tiles: Distance ("<n> km", "great-circle"), Duration ("<h>h <m>m", "<dep> → <arr> UTC"), Avg ground speed (distance ÷ duration, "gate to gate"), Cruise ("FL<altitude/100>"); the design's "max FL380" is left out (not in the report) (user confirmed assumption)
- Map: OpenStreetMap tiles with their attribution, fitted to the route, Leaflet zoom buttons; the whole path dashed grey, the flown part up to the selected waypoint solid blue, airport markers with "<IATA> <city>" labels, a marker per waypoint, and an aircraft icon at the selected waypoint turned along the path; legend "Flown" / "Remaining" (user confirmed assumption)
- Hovering, focusing or clicking a waypoint marker or its button in the strip under the map selects it; the selected waypoint shows a card with name, time (UTC), position, altitude ("Ground" at 0 ft, else FL), ground speed and "flown / left" distance, plus "<flight> · <aircraft model>"; departure is selected at first (user confirmed assumption)
- A route that crosses the antimeridian (e.g. a Pacific flight) is drawn the short way, without a line across the whole map (user confirmed assumption)
- The tile URL and attribution are UI config values (default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`) (user confirmed assumption)
- Origin and destination cards: IATA code and name, coordinates ("51.4700° N, 0.4543° W"), departure / arrival in UTC ("28 Oct 2026, 10:35 UTC") and the local time in the airport's time zone ("10:35 GMT"); the Aircraft card: Flight, Type (model), Registration, Data source "Mock generator"; the Job card: priority, attempts, created, started, completed (worker and idempotency key left out until those features exist) (user confirmed assumption)
- The Result card shows the whole report JSON with a Copy button and "result · <n> path points"; "Download JSON" saves the result as `transit-<job id>.json` (user confirmed assumption)
- The report page has no Payload card and no Lifecycle timeline, as in the design (the payload is in the title and airport cards) (user confirmed assumption)
- The report page refreshes by the same polling as the job page, and the "Job not found", loading and error states are those of the job page (user confirmed assumption)
- The roadmap's `flight-transit-map` row is replaced by `flight-transit-job-ui`, depending on `flight-transit-job` and `job-ui-crud`; `flight-transit-job-execution` stays a separate change (user confirmed assumption)
- Tests: unit tests for the presenter and form schema, component tests (Vitest + Testing Library) for the form, combobox, Details cell and report page, and a job-ui Playwright test of the report with its map against a mocked API; no system e2e until the worker generates reports (user confirmed assumption)

## Assumed

- [x] All requirements go into the existing `job-ui` capability (as webhook-job-ui did); no new capability - the report is one more job-ui page
- [x] Choosing Aircraft transit shows `/jobs/new?type=flight-transit`; opening it directly selects the type, Back returns to the previous type, Priority and Max attempts are kept on switching - same rules as Email/Webhook
- [x] "2. Payload" shows Origin airport, Destination airport and Departure date in one row (as in the design), both airports empty at first and the date set to today's UTC date; the note reads "Pick two bundled airports. The worker generates the flight, its great-circle path and waypoints." - the design's note mentions typing IATA codes, which the combobox replaces
- [x] An airport option reads "<IATA> · <name>, <city>" and the search matches code, name, city and country, case-insensitive; the closed field shows the chosen code and name; "No airport found" when nothing matches - enough to find a hub by city or code
- [x] The form checks the API's rules before sending: both airports required, the two must differ (error under Destination), the date must be a real date not before today's UTC date (error under Departure date); API `VALIDATION_FAILED` issues map to the fields like the other types - same rules as the API, which checks the UTC day
- [x] The transit Details cell shows "<origin> → <destination> · <departure date, e.g. 28 Oct>" while the job waits or runs, "<flight> · <distance> km" when completed, and the error message when failed - like the per-status detail of email and webhook
- [x] The report header: title "<origin> → <destination>", status and type badges, subtitle "Aircraft transit report · <full id> · generated in <total time>"; the design's worker name is left out (not in the API yet); the existing "Copy as cURL" and "Delete job" buttons stay next to "Download JSON" and "Run again" - the report must not lose actions the job page has
- [x] Summary tiles: Distance ("<n> km", "great-circle"), Duration ("<h>h <m>m", "<dep> → <arr> UTC"), Avg ground speed (distance ÷ duration, "gate to gate"), Cruise ("FL<altitude/100>"); the design's "max FL380" is left out (not in the report) - only values the report carries or that follow from it
- [x] Map: OpenStreetMap tiles with their attribution, fitted to the route, Leaflet zoom buttons; the whole path dashed grey, the flown part up to the selected waypoint solid blue, airport markers with "<IATA> <city>" labels, a marker per waypoint, and an aircraft icon at the selected waypoint turned along the path; legend "Flown" / "Remaining" - as in the design
- [x] Hovering, focusing or clicking a waypoint marker or its button in the strip under the map selects it; the selected waypoint shows a card with name, time (UTC), position, altitude ("Ground" at 0 ft, else FL), ground speed and "flown / left" distance, plus "<flight> · <aircraft model>"; departure is selected at first - as in the design; it opens on the departure so the whole route reads as remaining
- [x] A route that crosses the antimeridian (e.g. a Pacific flight) is drawn the short way, without a line across the whole map - otherwise such routes look wrong
- [x] The tile URL and attribution are UI config values (default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`) - so a deployment can switch tile servers without a code change
- [x] Origin and destination cards: IATA code and name, coordinates ("51.4700° N, 0.4543° W"), departure / arrival in UTC ("28 Oct 2026, 10:35 UTC") and the local time in the airport's time zone ("10:35 GMT"); the Aircraft card: Flight, Type (model), Registration, Data source "Mock generator"; the Job card: priority, attempts, created, started, completed (worker and idempotency key left out until those features exist) - the report's fields, the browser's Intl for time zones
- [x] The Result card shows the whole report JSON with a Copy button and "result · <n> path points"; "Download JSON" saves the result as `transit-<job id>.json` - the same data the Result card shows
- [x] The report page has no Payload card and no Lifecycle timeline, as in the design (the payload is in the title and airport cards) - follows the design
- [x] The report page refreshes by the same polling as the job page, and the "Job not found", loading and error states are those of the job page - one behaviour for all job pages
- [x] The roadmap's `flight-transit-map` row is replaced by `flight-transit-job-ui`, depending on `flight-transit-job` and `job-ui-crud`; `flight-transit-job-execution` stays a separate change - the map moved into this change
- [x] Tests: unit tests for the presenter and form schema, component tests (Vitest + Testing Library) for the form, combobox, Details cell and report page, and a job-ui Playwright test of the report with its map against a mocked API; no system e2e until the worker generates reports - a completed transit job cannot exist in the running stack yet

## Open questions

- [x] Scope: form and list only, form plus the report with the map, or the report only?
- [x] How are airports picked: searchable list, free text, or plain select?
- [x] Which combobox library?
- [x] Where does the report appear: the completed job's page, a section of the job page, or its own route?
- [x] What do "Download JSON" and "Run again" do?
