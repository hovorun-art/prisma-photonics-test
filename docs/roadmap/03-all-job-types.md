# Milestone 3: All job types

A user can submit every job type the task describes (email, webhook, aircraft transit report, batch)
and see each one's result in the UI, including the aircraft transit on a map.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `webhook-job` | Webhook job type with simulated random failures | `email-job-execution` |
| `flight-transit-job` | Aircraft transit report job: two airports, dates, generated route and aircraft data | `email-job-execution` |
| `flight-transit-map` | Show a transit report's route on a map, with hover details for aircraft and transit | `flight-transit-job` |
| `batch-job` | Batch job type: processes items one by one, reports progress, returns a summary | `email-job-execution` |

## Open questions

- [ ] Batch job: what an item is (generic payload or a sub-task of another job type); one failed item
  fails the job or gives a partial summary; resume from the last processed item after a crash or
  restart from the beginning.
- [ ] Transit report: which airports are bundled, what aircraft details are generated.
