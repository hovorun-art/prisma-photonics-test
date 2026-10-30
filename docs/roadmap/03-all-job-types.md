# Milestone 3: All job types

A user can submit every job type the task describes (email, webhook, aircraft transit report) and see
each one's result in the UI, including the aircraft transit on a map. The task's Batch job is answered
by job groups instead (milestone 6).

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `webhook-job` | Webhook job type with simulated random failures | `email-job-execution` |
| `webhook-job-execution` | Run webhook jobs: simulated call with a configured wait and random 5xx failures | `webhook-job` |
| `webhook-job-ui` | Submit webhook jobs in the UI and show them in the list and on the job page | `webhook-job`, `job-ui-crud` |
| `flight-transit-job` | Aircraft transit report job: two airports, dates, generated route and aircraft data | `email-job-execution` |
| `flight-transit-job-execution` | Generate the transit report in job-execution-service: flight, aircraft, times, great-circle path and waypoints | `flight-transit-job` |
| `flight-transit-map` | Show a transit report's route on a map, with hover details for aircraft and transit | `flight-transit-job-execution` |

## Open questions

- [x] Batch job: what an item is, how a failed item and a crash are handled. (Answered in
  `job-bulk-create`: there is no batch job type; job groups replace it. A group's items are real
  jobs of any type, submitted in one bulk request and followed by job-group-service, see milestone 6.)
- [x] Transit report: which airports are bundled, what aircraft details are generated. (Answered in
  `flight-transit-job`: about 50 major hubs on every inhabited continent; the report carries flight,
  aircraft model and registration, airports, times, distance, duration, cruise altitude, path and
  waypoints.)
