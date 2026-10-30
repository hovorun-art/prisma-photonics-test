# Spec Delta

## ADDED Requirements

### Requirement: A flight transit job simulates fetching its flight data
Running a flight transit job SHALL call no external service. It SHALL wait the configured generation
time and then end as a success or a failure; each attempt fails at random with the configured
failure rate, and every attempt draws its report anew.

#### Scenario: Flight transit job takes the configured time
- **WHEN** a flight transit job is run
- **THEN** it finishes only after the configured generation time has passed

#### Scenario: Transit failure rate zero never fails
- **WHEN** flight transit jobs are run with a configured failure rate of zero
- **THEN** every run completes with a report

#### Scenario: Transit failure rate one always fails
- **WHEN** flight transit jobs are run with a configured failure rate of one
- **THEN** every run fails

#### Scenario: Each attempt generates a new report
- **WHEN** the same flight transit job is run twice and both runs succeed
- **THEN** each run returns its own report, generated from that run's random draws

### Requirement: A failed transit attempt reports unavailable flight data
A flight transit run that fails SHALL fail the attempt with code `FLIGHT_TRANSIT_DATA_UNAVAILABLE`,
the message `Flight data for <ORIGIN>-<DESTINATION> is unavailable` and details with the job's
`origin` and `destination`. job-service then retries the job or fails it, as for any failed attempt.

#### Scenario: Failed transit attempt carries the route
- **WHEN** a flight transit job from `LHR` to `JFK` is run and the attempt fails
- **THEN** the attempt fails with code `FLIGHT_TRANSIT_DATA_UNAVAILABLE`, the message `Flight data for LHR-JFK is unavailable` and details `{ origin: "LHR", destination: "JFK" }`

#### Scenario: Failed transit attempt is logged as a warning
- **WHEN** a flight transit job's attempt fails
- **THEN** a warning log line is written with the job id, the attempt, the instance id and the code `FLIGHT_TRANSIT_DATA_UNAVAILABLE`

### Requirement: The report describes the submitted route
A completed flight transit job's report SHALL name the job's own airports: `origin` and
`destination` carry the IATA code, name, city, time zone and coordinates of the payload's airports
from the bundled list. `distanceKm` SHALL be the great-circle distance between them on a sphere of
radius 6371 km, rounded to whole kilometres.

#### Scenario: Report airports are the payload's airports
- **WHEN** a flight transit job from `LHR` to `JFK` completes
- **THEN** the report's `origin` and `destination` equal the bundled entries for `LHR` and `JFK` (iata, name, city, time zone, latitude, longitude)

#### Scenario: Report distance is the great-circle distance
- **WHEN** a flight transit job from `LHR` to `JFK` completes
- **THEN** `distanceKm` equals the great-circle distance between the two bundled airports' coordinates on a sphere of radius 6371 km, rounded to whole kilometres

### Requirement: The report path follows the great circle
The report's `path` SHALL hold the configured number of points along the great-circle route, evenly
spaced by distance, starting at the origin airport and ending at the destination airport, with every
longitude in [-180, 180].

#### Scenario: Path runs from origin to destination
- **WHEN** a flight transit job from `LHR` to `JFK` completes
- **THEN** `path` has the configured number of points, its first point is `LHR`'s coordinates, its last is `JFK`'s, and each point lies on the great circle between them at an equal distance from its neighbours

#### Scenario: Path across the antimeridian stays in range
- **WHEN** a flight transit job whose route crosses the 180th meridian (e.g. `NRT` to `LAX`) completes
- **THEN** every longitude in `path` and in `waypoints` lies in [-180, 180]

### Requirement: The flight leaves on the departure date at the origin
`departureAt` SHALL be a time within the payload's `departureDate` in the origin airport's local
time zone, on a whole five minutes, given as a UTC timestamp, drawn at random per attempt.
`arrivalAt` SHALL be `departureAt` plus `durationMin`.

#### Scenario: Departure lies within the date in the origin's time zone
- **WHEN** a flight transit job from `SYD` with departure date `2026-11-02` completes
- **THEN** `departureAt`, read in `Australia/Sydney`, falls on 2026-11-02, even when its UTC date is 2026-11-01

#### Scenario: Departure is on a whole five minutes
- **WHEN** a flight transit job completes
- **THEN** the minutes of `departureAt` are a multiple of five and its seconds are zero

#### Scenario: Arrival is departure plus duration
- **WHEN** a flight transit job completes
- **THEN** `arrivalAt` is exactly `durationMin` minutes after `departureAt`

### Requirement: The aircraft fits the distance
A flight shorter than the configured long-haul distance SHALL be flown by a narrow-body model
(A320neo or B737 MAX), any other by a wide-body model (A350-900, B787-9 or B777-300ER), drawn at
random within the class. `cruiseAltitudeFt` and the cruise ground speed SHALL be that model's own.

#### Scenario: Short-haul flight gets a narrow-body aircraft
- **WHEN** a flight transit job whose distance is below the configured long-haul distance (e.g. `LHR` to `CDG`) completes
- **THEN** `aircraft.model` is A320neo or B737 MAX and `cruiseAltitudeFt` is that model's cruise altitude

#### Scenario: Long-haul flight gets a wide-body aircraft
- **WHEN** a flight transit job whose distance is at or above the configured long-haul distance (e.g. `LHR` to `JFK`) completes
- **THEN** `aircraft.model` is A350-900, B787-9 or B777-300ER and `cruiseAltitudeFt` is that model's cruise altitude

### Requirement: The flight has a generated number and registration
`flight` SHALL be an airline code from the bundled airline list, a space and one to four digits
(e.g. `BA 117`). `aircraft.registration` SHALL be a registration prefix, a hyphen and four
upper-case letters (e.g. `G-XWBA`). Both are drawn at random per attempt.

#### Scenario: Flight number and registration have their formats
- **WHEN** a flight transit job completes
- **THEN** `flight` is a bundled airline code, a space and one to four digits, and `aircraft.registration` is a prefix, a hyphen and four upper-case letters

### Requirement: The waypoints follow the flight phases
A flight at least as long as the configured climb plus descent distance SHALL have the waypoints
Departure (origin IATA), Top of climb, the configured number of cruise points `Cruise 1`..`Cruise N`
evenly spaced between them, Top of descent and Arrival (destination IATA), in that order.

#### Scenario: Long flight waypoints in phase order
- **WHEN** a flight transit job from `LHR` to `JFK` completes
- **THEN** the waypoint names are `LHR`, `Top of climb`, `Cruise 1` to `Cruise N` for the configured N, `Top of descent`, `JFK`, the first at `LHR`'s coordinates and the last at `JFK`'s

#### Scenario: Long flight altitude and speed profile
- **WHEN** a flight transit job from `LHR` to `JFK` completes
- **THEN** the first and last waypoints have altitude 0 and the configured taxi speed, and Top of climb, every cruise point and Top of descent have `cruiseAltitudeFt` and the model's cruise speed

### Requirement: A short flight peaks once
A flight shorter than the configured climb plus descent distance SHALL have exactly three waypoints:
Departure (origin IATA), `Peak` at the route's midpoint, and Arrival (destination IATA). The peak
altitude SHALL be below the model's cruise altitude.

#### Scenario: Short flight has a single peak waypoint
- **WHEN** a flight transit job whose distance is below the configured climb plus descent distance (e.g. `LHR` to `CDG`) completes
- **THEN** the waypoints are `LHR`, `Peak`, `CDG`, `Peak` lies at half the distance with an altitude above 0 and below the model's cruise altitude, and the departure and arrival waypoints have altitude 0

### Requirement: Waypoint times and distances are consistent with the report
Along the waypoints, `distanceFlownKm` SHALL grow from 0 at departure to `distanceKm` at arrival and
`at` SHALL grow from `departureAt` to `arrivalAt`; `durationMin` SHALL be the time the altitude and
speed profile takes over the distance, rounded to whole minutes.

#### Scenario: Waypoint distance and time run from departure to arrival
- **WHEN** a flight transit job completes
- **THEN** the first waypoint has `distanceFlownKm` 0 and `at` equal to `departureAt`, the last has `distanceFlownKm` equal to `distanceKm` and `at` equal to `arrivalAt`, and both values never decrease along the waypoints

### Requirement: The generated report is logged
A completed flight transit run SHALL write an info log line with the job id, the attempt, the
instance id, the flight number, the distance and the duration.

#### Scenario: Generated flight is logged
- **WHEN** a flight transit job completes
- **THEN** an info log line is written with the job id, the attempt, the instance id, `flight`, `distanceKm` and `durationMin`
