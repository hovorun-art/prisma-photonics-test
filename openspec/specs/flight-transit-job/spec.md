# flight-transit-job Specification

## Purpose

Defines the aircraft transit job type from a client's point of view: the flight it describes (two
airports from a bundled list and a departure date), how a submission is validated, and the report a
completed transit job returns.

## Requirements

### Requirement: Clients can submit a flight transit job
`POST /v1/jobs` with type `flight-transit`, a payload with `origin` and `destination` (IATA airport
codes) and `departureDate` (a calendar date `YYYY-MM-DD`), and optionally a priority and max
attempts SHALL store a new job and answer HTTP 201 with the job, as described for any job in
job-management.

#### Scenario: Valid flight transit job is accepted
- **WHEN** a client submits a job with type `flight-transit`, origin `LHR`, destination `JFK` and a departure date later than today
- **THEN** the response has HTTP status 201 and the job with type `flight-transit`, a UUID id, status `pending`, zero attempts, the given payload, and `null` result and error

#### Scenario: Flight transit job is read and listed like any job
- **WHEN** a client submits a flight transit job and then gets it by the returned id and lists jobs
- **THEN** the get response is the same job, and the list contains it with type `flight-transit` next to email and webhook jobs

### Requirement: Airports come from the bundled airport list
`origin` and `destination` SHALL be accepted only when they are the upper-case IATA code of an
airport in the bundled airport list. Each bundled airport has an IATA code, name, city, country,
latitude, longitude and IANA time zone; the list includes `LHR` and `JFK` and spans every inhabited
continent. Any other code SHALL be answered with HTTP 400 and `VALIDATION_FAILED` and store nothing.

#### Scenario: Unknown airport code
- **WHEN** a client submits a flight transit job whose `origin` is `XXX`, a code not in the bundled list
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.origin` field, and no job is stored

#### Scenario: Lower-case airport code
- **WHEN** a client submits a flight transit job whose `destination` is `jfk`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.destination` field

#### Scenario: Bundled airports cover the inhabited continents
- **WHEN** the bundled airport list is read
- **THEN** every airport has a unique three-letter upper-case code, a name, city, country, a latitude in [-90, 90], a longitude in [-180, 180] and a valid IANA time zone, the list contains `LHR` and `JFK`, and it has airports in Europe, Asia, Africa, North America, South America and Oceania

### Requirement: Origin and destination differ
A flight transit submission whose `origin` and `destination` are the same airport SHALL be answered
with HTTP 400 and `VALIDATION_FAILED` with an issue for `payload.destination`, and store nothing.

#### Scenario: Same airport twice
- **WHEN** a client submits a flight transit job with origin `LHR` and destination `LHR`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.destination` field, and no job is stored

### Requirement: The departure day is not over
A flight transit submission SHALL be accepted only while its `departureDate`, taken as a UTC day, is
not over at job-service's current time: today and later days are accepted; an earlier day SHALL be
answered with HTTP 400 and `VALIDATION_FAILED` with an issue for `payload.departureDate`, and store
nothing.

#### Scenario: Departure today is accepted
- **WHEN** a client submits a flight transit job whose departure date is today's UTC date, late in that UTC day
- **THEN** the response has HTTP status 201 and the job is stored

#### Scenario: Departure yesterday is rejected
- **WHEN** a client submits a flight transit job whose departure date is yesterday's UTC date, early in today's UTC day
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.departureDate` field, and no job is stored

### Requirement: Invalid flight transit payloads are rejected
A flight transit submission with a missing `origin`, `destination` or `departureDate`, a code that is
not three upper-case letters, or a `departureDate` that is not a real calendar date in the form
`YYYY-MM-DD` SHALL be answered with HTTP 400 and `VALIDATION_FAILED`, with an issue for each wrong
field, and SHALL store nothing.

#### Scenario: Missing payload fields
- **WHEN** a client submits a flight transit job whose payload has no `origin`, `destination` or `departureDate`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for each of `payload.origin`, `payload.destination` and `payload.departureDate`

#### Scenario: Airport code of the wrong form
- **WHEN** a client submits a flight transit job whose `origin` is `LH` or `LHRX`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.origin` field

#### Scenario: Departure date is not a calendar date
- **WHEN** a client submits a flight transit job whose `departureDate` is `2026-02-30`, `30/10/2026` or a full timestamp
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.departureDate` field

### Requirement: A completed flight transit job stores its report
A `completed` report for a flight transit job SHALL carry a result with `flight`, `aircraft`
(`model`, `registration`), `origin` and `destination` (`iata`, `name`, `city`, `timeZone`, `lat`,
`lon`), `departureAt` and `arrivalAt` (ISO timestamps), `distanceKm`, `durationMin`,
`cruiseAltitudeFt`, `path` and `waypoints`; job-service SHALL store it and return it as the job's
result.

#### Scenario: Transit report is stored
- **WHEN** job-execution-service reports a `processing` flight transit job `completed` with a well-formed report
- **THEN** the response has HTTP status 200 and the job in status `completed` with that report as its result, and getting the job returns the same result

#### Scenario: Report for other airports than the payload is stored
- **WHEN** job-execution-service reports a flight transit job for `LHR` to `JFK` `completed` with a well-formed report whose origin is `CDG`
- **THEN** the response has HTTP status 200 and the job is `completed` with that report

### Requirement: A malformed transit report is rejected
A transit report SHALL have every latitude in [-90, 90], every longitude in [-180, 180], no negative
numbers, a `path` of at least two `[lat, lon]` points and at least two waypoints, each with `name`,
`at`, `lat`, `lon`, `altitudeFt`, `groundSpeedKmh` and `distanceFlownKm`. A report that does not
SHALL be answered with HTTP 400 and `VALIDATION_FAILED` and leave the job unchanged.

#### Scenario: Transit report does not match
- **WHEN** job-execution-service reports a flight transit job `completed` with a report that has no `aircraft`, or a latitude of 91, or a negative `distanceKm`, or a `path` of one point, or a single waypoint
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED`, and the job is unchanged

### Requirement: A failed flight transit attempt uses the shared error
A `failed` report for a flight transit job SHALL be stored as the job's error as sent, with the same
`code`, `message` and `details` shape as every other job type.

#### Scenario: Failed transit error is returned as sent
- **WHEN** job-execution-service reports a `processing` flight transit job on its last attempt `failed` with a code, a message and details
- **THEN** getting the job returns status `failed`, attempts equal to max attempts, and an error with that code, message and details
