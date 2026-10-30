# Milestone 3: All job types

A user can submit every job type the task describes (email, webhook, aircraft transit report, batch)
and see each one's result in the UI, including the aircraft transit on a map.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `webhook-job` | Webhook job type with simulated random failures | `email-job-execution` |
| `webhook-job-execution` | Run webhook jobs: simulated call with a configured wait and random 5xx failures | `webhook-job` |
| `webhook-job-ui` | Submit webhook jobs in the UI and show them in the list and on the job page | `webhook-job`, `job-ui-crud` |
| `flight-transit-job` | Aircraft transit report job: two airports, dates, generated route and aircraft data | `email-job-execution` |
| `flight-transit-job-execution` | Generate the transit report in job-execution-service: flight, aircraft, times, great-circle path and waypoints | `flight-transit-job` |
| `flight-transit-map` | Show a transit report's route on a map, with hover details for aircraft and transit | `flight-transit-job-execution` |
| `batch-job` | Batch job type: processes items one by one, reports progress, returns a summary | `email-job-execution` |

## Open questions

- [ ] Batch job: what an item is (generic payload or a sub-task of another job type); one failed item
  fails the job or gives a partial summary; resume from the last processed item after a crash or
  restart from the beginning.
- [x] Transit report: which airports are bundled, what aircraft details are generated. (Answered in
  `flight-transit-job`: about 50 major hubs on every inhabited continent; the report carries flight,
  aircraft model and registration, airports, times, distance, duration, cruise altitude, path and
  waypoints.)
