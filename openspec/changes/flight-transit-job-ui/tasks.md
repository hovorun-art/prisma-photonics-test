# Tasks

## Plan

```
1 Foundation ──┬── 2 Transit form ──────────────┐
               └── 3 Report model ── 4 Report page ── 5 Integration
```

Groups 2 and 3 could run in parallel (disjoint files); 4 needs 3; 5 needs all. Default: sequential.
Each group ends with its own commit (decided by the user); every commit is shown first and made
only with the user's approval.

## 1. Foundation

Owns: `apps/job-ui/package.json`, `package-lock.json`, `apps/job-ui/src/config/ui-config.ts`,
`apps/job-ui/src/locales/en.ts`, `apps/job-ui/src/components/ui/command.tsx`,
`apps/job-ui/src/components/ui/popover.tsx`, `apps/job-ui/src/features/jobs/testing/job-fixtures.ts`,
`docs/roadmap/03-all-job-types.md`, `DECISIONS.md` · Depends on: none · Parallel with: none

- [x] 1.1 Add `cmdk`, `leaflet`, `react-leaflet` and `@job-queue/kernel` to job-ui's dependencies and `@types/leaflet` to its dev dependencies; verify `npm install` and `npm run typecheck -w @job-queue/job-ui` succeed
- [x] 1.2 Add the shadcn `command.tsx` (on `cmdk`) and `popover.tsx` (on `radix-ui`) primitives; verify `npm run lint -w @job-queue/job-ui` passes
- [x] 1.3 Add `mapTileUrl` and `mapTileAttribution` to `UiConfig` with the OSM defaults; verify typecheck
- [x] 1.4 Add every new string of the change to `locales/en.ts` (transit type card, transit form labels, note, airport option, "No airport found", field messages, transit Details, report title/subtitle, tiles, cards, waypoint card, legend, Download JSON, Run again); verify typecheck
- [x] 1.5 Add `transitJob()` fixtures (LHR → JFK completed with a full report, and a Pacific route crossing the antimeridian) to `job-fixtures.ts`, built from `randomUUID()` and parsed with `FlightTransitJob`; verify an existing job-ui test still passes
- [x] 1.6 Replace the roadmap's `flight-transit-map` row with `flight-transit-job-ui` and record the `cmdk` choice with its numbers and reason in `DECISIONS.md`; verify the files read as decided
- [x] 1.7 Show the stage's diff and commit message (`chore(job-ui): add transit dependencies, config, strings and fixtures`) and commit after the user's approval

## 2. Transit form

Owns: `apps/job-ui/src/features/jobs/model/{transit-form-values.ts,zod-transit-job-draft.ts,zod-transit-job-draft.test.ts,airport-search.ts,airport-search.test.ts}`,
`apps/job-ui/src/features/jobs/hooks/use-transit-job-draft.ts`,
`apps/job-ui/src/features/jobs/submit/{airport-combobox.tsx,transit-payload-fields.tsx,job-type-picker.tsx,job-form.tsx,submit-job-page.tsx,request-preview.tsx,submit-job-page.test.tsx}` ·
Depends on: 1 · Parallel with: 3

- [x] 2.1 Write failing unit tests for `ZodTransitJobDraft` (scenarios "Transit form at first" values with today's UTC date via `vi.setSystemTime`, "Missing airport", "Same airport twice", "Departure date in the past", "API validation error on a transit field" mapping, "Preview of a transit request"); see them fail
- [x] 2.2 Implement `TransitFormValues` and `ZodTransitJobDraft` (`d: { clock }`) and `useTransitJobDraft`; verify 2.1 passes
- [x] 2.3 Write failing unit tests for `AirportSearch` (scenarios "Search by city", "Search by code ignores case", "Nothing matches"); implement it; verify they pass
- [x] 2.4 Write failing component tests in `submit-job-page.test.tsx` for "Choose Aircraft transit", "Direct link to the transit form", "Switching to transit keeps the execution settings", "Disabled job types", "Transit form at first", "Submit a valid transit job", "Choosing an airport", "Search by city", "Nothing matches", "Missing airport", "Same airport twice", "Departure date in the past", "API validation error on a transit field", "Preview of a transit request", "Example response for a transit job"; see them fail
- [x] 2.5 Implement `AirportCombobox`, `TransitPayloadFields`, the enabled Aircraft transit card, the `?type=flight-transit` switch and the transit preview; verify 2.4 passes
- [x] 2.6 Run the `test-case-reviewer` subagent on job-ui unit and component tests of `features/jobs/model/{zod-transit-job-draft,airport-search}` and `features/jobs/submit/submit-job-page.test.tsx`; add the missing cases it reports or note why they belong elsewhere
- [x] 2.7 Show the stage's diff and commit message (`feat(job-ui): submit aircraft transit jobs`) and commit after the user's approval

## 3. Report model and list Details

Owns: `apps/job-ui/src/features/transit-map/model/*` (presentation interface, `intl-transit-report-presenter.ts`, `mercator-route-geometry.ts`, their tests),
`apps/job-ui/src/features/jobs/model/{job-presenter.ts,job-presenter.test.ts}`,
`apps/job-ui/src/features/jobs/list/jobs-list-page.test.tsx` · Depends on: 1 · Parallel with: 2

- [x] 3.1 Write failing tests in `job-presenter.test.ts` and `jobs-list-page.test.tsx` for "Waiting or running transit job", "Completed transit job", "Failed transit job"; see them fail
- [x] 3.2 Implement the transit branch of `JobPresenter.details`; verify 3.1 passes
- [x] 3.3 Write failing unit tests for `IntlTransitReportPresenter`: "Summary tiles", "Airport cards" (coordinates, UTC time, local `GMT` / `EDT`), waypoint card values for "Departure selected at first" (`Ground`) and "Hover a waypoint" (flight level, ground speed, flown / left), title and subtitle of "Report header"; see them fail
- [x] 3.4 Implement `TransitReportPresentation` and `IntlTransitReportPresenter`; verify 3.3 passes
- [x] 3.5 Write failing unit tests for `MercatorRouteGeometry`: "Route across the antimeridian" (unwrapped longitudes, no step over 180°), flown path for departure (empty) and arrival (whole path), bearing at a waypoint; see them fail
- [x] 3.6 Implement `RouteGeometry` and `MercatorRouteGeometry`; verify 3.5 passes
- [x] 3.7 Run the `test-case-reviewer` subagent on job-ui unit tests of `features/transit-map/model` and `features/jobs/model/job-presenter.test.ts`, and on `features/jobs/list/jobs-list-page.test.tsx`; add the missing cases it reports or note why they belong elsewhere
- [x] 3.8 Show the stage's diff and commit message (`feat(job-ui): summarise transit jobs and model the transit report`) and commit after the user's approval

## 4. Report page and map

Owns: `apps/job-ui/src/features/transit-map/*.tsx` (report, map, waypoint strip, waypoint card, report cards, tests), `apps/job-ui/src/features/transit-map/index.ts`,
`apps/job-ui/src/features/jobs/details/{job-page.tsx,job-page.test.tsx}`, `apps/job-ui/test/e2e/transit.spec.ts` ·
Depends on: 1, 3 · Parallel with: none

- [x] 4.1 Write failing tests in `job-page.test.tsx` for "Completed transit job opens the report", "Waiting transit job keeps the normal page", "Failed transit job keeps the normal page", "Job completes while its page is open"; see them fail
- [x] 4.2 Write failing tests in `transit-report.test.tsx` for "Report header", "Download the report", "Delete from the report", "Run again is disabled", "Summary tiles", "Airport cards", "Aircraft card", "Copy the report", "Departure selected at first", "Hover a waypoint", "Select from the strip", and "Route on the map" (airport labels, one marker per waypoint, aircraft icon, legend); see them fail
- [x] 4.3 Implement `TransitReport` (header, tiles, cards, download), `TransitMap` (react-leaflet, divIcon markers, polylines, legend), `WaypointStrip`, `WaypointCard` and the switch in `JobPage`; verify 4.1 and 4.2 pass
- [x] 4.4 Write the job-ui Playwright test `transit.spec.ts` for "Route on the map", "Hover a waypoint" and "Route across the antimeridian" against a `page.route` job-service and blank tiles; verify `npm run test:e2e -w @job-queue/job-ui` passes
- [x] 4.5 Compare the running report with the design's TransitReport and SubmitTransit screens (screenshot of the app) and fix layout differences; verify by the screenshots
- [x] 4.6 Run the `test-case-reviewer` subagent on job-ui component tests of `features/transit-map` and `features/jobs/details/job-page.test.tsx`, and on the job-ui Playwright `test/e2e/transit.spec.ts`; add the missing cases it reports or note why they belong elsewhere
- [x] 4.7 Show the stage's diff and commit message (`feat(job-ui): show the transit report with its route map`) and commit after the user's approval

## 5. Integration

Owns: none beyond fixes the checks require · Depends on: 1, 2, 3, 4 · Parallel with: none

- [ ] 5.1 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`) and `npm run test:e2e`; verify all pass
- [ ] 5.2 Run the `change-verifier` subagent in the foreground; verify it returns PASS
- [ ] 5.3 If 5.1 or 5.2 needed fixes, show them and commit after the user's approval (`fix(job-ui): ...`)

## Workflow follow-up

- `/archive flight-transit-job-ui` after PASS, on the change branch, then merge into `master` with the user's approval.
