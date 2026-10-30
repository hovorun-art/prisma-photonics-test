# Spec Delta

## MODIFIED Requirements

### Requirement: Features not built yet are shown disabled
Design elements that need API features not built yet SHALL be shown muted and disabled, with a
"Coming soon" tooltip on hover and focus: the queue statistics cards (showing "—"), the "API
status —" pill, status and type filters, search, Cancel and Retry, "Run again" on the transit
report, the idempotency key and "At a specific time".

#### Scenario: Disabled filter
- **WHEN** a user hovers over or focuses a status filter on the jobs list
- **THEN** it is disabled and a "Coming soon" tooltip is shown

#### Scenario: Statistics without data
- **WHEN** a user opens the jobs list
- **THEN** the queue statistics cards show "—" instead of numbers and the header pill reads "API status —"

#### Scenario: Disabled job types
- **WHEN** a user opens the submit page
- **THEN** the Webhook and Aircraft transit job types can be chosen and Email is selected

#### Scenario: Run again is disabled
- **WHEN** a user hovers over or focuses "Run again" on the report of a completed transit job
- **THEN** it is disabled and a "Coming soon" tooltip is shown

### Requirement: Users can choose the job type on the submit page
The "1. Job type" cards SHALL switch the form in place between Email, Webhook and Aircraft transit.
Choosing Webhook SHALL show `/jobs/new?type=webhook`, choosing Aircraft transit
`/jobs/new?type=flight-transit`, choosing Email `/jobs/new`; opening any of these URLs directly
SHALL show that type selected, and Back SHALL return to the previous type. Switching SHALL keep
Priority and Max attempts and start the chosen type's payload fields at their initial values.

#### Scenario: Choose Webhook
- **WHEN** a user on `/jobs/new` clicks the Webhook card
- **THEN** the Webhook card is selected, the payload section shows the webhook fields and the URL is `/jobs/new?type=webhook`

#### Scenario: Choose Aircraft transit
- **WHEN** a user on `/jobs/new` clicks the Aircraft transit card
- **THEN** the Aircraft transit card is selected, the payload section shows the transit fields and the URL is `/jobs/new?type=flight-transit`

#### Scenario: Direct link to the webhook form
- **WHEN** a user opens `/jobs/new?type=webhook` directly
- **THEN** the Webhook card is selected and the webhook fields are shown

#### Scenario: Direct link to the transit form
- **WHEN** a user opens `/jobs/new?type=flight-transit` directly
- **THEN** the Aircraft transit card is selected and the transit fields are shown

#### Scenario: Back to the previous type
- **WHEN** a user chooses Webhook on `/jobs/new` and presses the browser's Back button
- **THEN** the Email card is selected and the email fields are shown

#### Scenario: Switching keeps the execution settings
- **WHEN** a user changes Priority, types a subject, chooses Webhook and then Email again
- **THEN** Priority keeps the changed value and the email fields are empty

#### Scenario: Switching to transit keeps the execution settings
- **WHEN** a user changes Max attempts, picks an origin airport, chooses Email and then Aircraft transit again
- **THEN** Max attempts keeps the changed value and the origin airport is empty

## ADDED Requirements

### Requirement: Users can submit an aircraft transit job
With Aircraft transit chosen, "2. Payload" SHALL show Origin airport, Destination airport and
Departure date in one row, matching the layout of the design's SubmitTransit screen, with both
airports empty, the date set to today's date in UTC, and the note "Pick two bundled airports. The
worker generates the flight, its great-circle path and waypoints." Submitting a valid form SHALL
create a transit job with the chosen values and open its page.

#### Scenario: Transit form at first
- **WHEN** a user opens `/jobs/new?type=flight-transit`
- **THEN** both airports are empty, Departure date holds today's UTC date, Priority and Max attempts hold the API's default values, and the note is shown

#### Scenario: Submit a valid transit job
- **WHEN** a user chooses Aircraft transit, picks LHR as origin and JFK as destination, keeps today's date and clicks "Submit job"
- **THEN** a transit job is created with origin LHR, destination JFK and that departure date, and the new job's page opens

### Requirement: Airports are picked from a searchable list
Each airport field SHALL open a searchable list of the bundled airports, each option reading
"<IATA> · <name>, <city>". Typing SHALL narrow the list to airports whose code, name, city or
country contains the text, ignoring case. Only listed airports SHALL be selectable; a chosen field
SHALL show the code and name.

#### Scenario: Search by city
- **WHEN** a user opens the Origin airport list and types `london`
- **THEN** the list shows the bundled London airports and no others

#### Scenario: Search by code ignores case
- **WHEN** a user opens the Destination airport list and types `jfk`
- **THEN** the list shows the JFK option

#### Scenario: Nothing matches
- **WHEN** a user types text that matches no bundled airport
- **THEN** the list shows "No airport found" and nothing can be chosen

#### Scenario: Choosing an airport
- **WHEN** a user chooses the LHR option
- **THEN** the field shows LHR and the airport's name and the list closes

### Requirement: The transit form is validated before sending
The transit form SHALL check its values with the same rules as the API before sending: both airports
are required, origin and destination must differ, and the departure date must be a real date not
before today's date in UTC. An invalid field SHALL be shown in red with its error under it, and
nothing SHALL be sent while a field is invalid.

#### Scenario: Missing airport
- **WHEN** a user leaves Origin airport empty and clicks "Submit job"
- **THEN** the Origin airport field shows an error under it and no request is sent

#### Scenario: Same airport twice
- **WHEN** a user picks LHR as both origin and destination and clicks "Submit job"
- **THEN** the Destination airport field shows an error under it and no request is sent

#### Scenario: Departure date in the past
- **WHEN** a user sets Departure date to yesterday's UTC date and clicks "Submit job"
- **THEN** the Departure date field shows an error under it and no request is sent

#### Scenario: API validation error on a transit field
- **WHEN** the API answers a transit submit with `VALIDATION_FAILED` and an issue for `payload.departureDate`
- **THEN** the Departure date field shows the issue's message and the chosen values stay

### Requirement: The request preview follows the transit form
With Aircraft transit chosen, the request preview, its "Copy cURL" command and the example
`201 Created` response SHALL show the transit request built from the form values, updated as the
user changes them.

#### Scenario: Preview of a transit request
- **WHEN** a user chooses Aircraft transit and picks LHR as origin
- **THEN** the request preview shows type `flight-transit`, origin `LHR` and the departure date in the request body

#### Scenario: Example response for a transit job
- **WHEN** a user chooses Aircraft transit
- **THEN** the Response box shows an example `201 Created` body with type `flight-transit` and status `pending`, marked as an example

### Requirement: The Details column summarises a transit job
For a transit job the Details column SHALL show "<origin> → <destination> · <departure day and
month>" while the job waits or runs, "<flight> · <distance> km" when it is completed, and the error
message when it has failed.

#### Scenario: Waiting or running transit job
- **WHEN** the list shows a transit job from LHR to JFK departing 2026-10-28 in status `scheduled`, `pending` or `processing`
- **THEN** its Details read "LHR → JFK · 28 Oct"

#### Scenario: Completed transit job
- **WHEN** the list shows a completed transit job whose report has flight "TX 401" and distance 5540 km
- **THEN** its Details read "TX 401 · 5,540 km"

#### Scenario: Failed transit job
- **WHEN** the list shows a failed transit job
- **THEN** its Details show the job's error message

### Requirement: A completed transit job's page shows its report
The page of a completed transit job SHALL show the transit report, matching the layout of the
design's TransitReport screen, instead of the normal job page; it has no Payload card and no
Lifecycle timeline. A transit job in any other status SHALL show the normal job page with its
payload, and for a failed job its error. Loading, not-found, error and polling behave as on any job
page.

#### Scenario: Completed transit job opens the report
- **WHEN** a user opens the page of a completed transit job
- **THEN** the page shows the transit report and no Payload card or Lifecycle timeline

#### Scenario: Waiting transit job keeps the normal page
- **WHEN** a user opens the page of a pending transit job
- **THEN** the page shows the normal job page with the transit payload in the Payload card

#### Scenario: Failed transit job keeps the normal page
- **WHEN** a user opens the page of a failed transit job
- **THEN** the page shows the normal job page with the alert box and the Error card

#### Scenario: Job completes while its page is open
- **WHEN** a transit job's page is open and a poll returns the job completed
- **THEN** the page switches to the transit report without a reload

### Requirement: The transit report header
The report SHALL be headed "<origin> → <destination>" with the status and type badges and the line
"Aircraft transit report · <full id> · generated in <total time>". Next to it SHALL be "Download
JSON", "Run again", "Copy as cURL" and, as on any finished job, "Delete job". "Download JSON" SHALL
save the report as `transit-<job id>.json`.

#### Scenario: Report header
- **WHEN** a user opens the report of a completed LHR to JFK transit job
- **THEN** the title reads "LHR → JFK", the completed status and transit type badges are shown, and the line under it shows the full id and the total time

#### Scenario: Download the report
- **WHEN** a user clicks "Download JSON"
- **THEN** a file `transit-<job id>.json` is saved holding the job's report

#### Scenario: Delete from the report
- **WHEN** a user clicks "Delete job" on the report and confirms
- **THEN** the job is deleted and the jobs list opens

### Requirement: The transit report summary
Under the header the report SHALL show four tiles: Distance ("<n> km", "great-circle"), Duration
("<h>h <m>m", "<departure> → <arrival> UTC"), Avg ground speed (distance divided by duration, in
km/h, "gate to gate") and Cruise ("FL<cruise altitude in hundreds of feet>").

#### Scenario: Summary tiles
- **WHEN** a user opens the report of a job with distance 5540 km, duration 465 minutes, departure 10:35 UTC, arrival 18:20 UTC and cruise altitude 36000 ft
- **THEN** the tiles read "5,540 km", "7h 45m" with "10:35 → 18:20 UTC", "715 km/h" and "FL360"

### Requirement: The transit report shows the route on a map
The report SHALL show a map with the configured tiles and their attribution, fitted to the route,
with zoom buttons. It SHALL draw the whole path dashed, the part flown up to the selected waypoint
solid, a labelled marker "<IATA> <city>" at each airport, a marker at each waypoint, an aircraft
icon at the selected waypoint turned along the path, and a "Flown" / "Remaining" legend.

#### Scenario: Route on the map
- **WHEN** a user opens the report of a completed transit job
- **THEN** the map shows the path, both airport labels, one marker per waypoint, the aircraft icon at the departure and the legend

#### Scenario: Route across the antimeridian
- **WHEN** a user opens the report of a job whose path crosses the 180° meridian
- **THEN** the path is drawn as one continuous line the short way, not across the whole map

### Requirement: Waypoints show their details
Hovering, focusing or clicking a waypoint marker, or its button in the strip under the map, SHALL
select that waypoint; the departure is selected at first. The selected waypoint SHALL show a card
with its name, time in UTC, position, altitude ("Ground" at zero, otherwise a flight level), ground
speed, distance flown and left, and "<flight> · <aircraft model>", and its strip button SHALL be
marked as pressed.

#### Scenario: Departure selected at first
- **WHEN** a user opens the report
- **THEN** the departure waypoint is selected, its card shows altitude "Ground" and the flown part of the path is empty

#### Scenario: Hover a waypoint
- **WHEN** a user hovers over a cruise waypoint marker
- **THEN** that waypoint becomes selected, its card shows its time, position, flight level, ground speed and flown / left distance, and the aircraft icon moves to it

#### Scenario: Select from the strip
- **WHEN** a user focuses or clicks the arrival button in the strip under the map
- **THEN** the arrival waypoint is selected, its button is pressed and the whole path is drawn as flown

### Requirement: The transit report shows airports, aircraft and job
Below the map the report SHALL show an Origin and a Destination card (IATA code, name, coordinates,
departure or arrival in UTC and the local time at that airport), an Aircraft card (Flight, Type,
Registration, Data source "Mock generator"), a Job card (priority, attempts, created, started,
completed), and a Result card with the report JSON, the number of path points and a Copy button.

#### Scenario: Airport cards
- **WHEN** a user opens the report of a job departing LHR at 10:35 UTC on 28 Oct 2026
- **THEN** the Origin card shows LHR, its name, its coordinates as "51.4700° N, 0.4543° W", "28 Oct 2026, 10:35 UTC" and the local time "10:35 GMT"

#### Scenario: Aircraft card
- **WHEN** a user opens the report of a job whose report has flight "TX 401", model "Boeing 777-300ER" and registration "G-TXAA"
- **THEN** the Aircraft card shows those three values and Data source "Mock generator"

#### Scenario: Copy the report
- **WHEN** a user clicks Copy on the Result card
- **THEN** the report JSON is copied and the button reads "Copied" for a moment
