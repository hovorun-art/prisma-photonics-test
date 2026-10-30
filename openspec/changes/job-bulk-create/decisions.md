# Decisions: job-bulk-create

## Decided

- Job groups replace the task's Batch job type; `batch-job` leaves the roadmap (user)
- The work is split into two changes: `job-bulk-create` (job-service) and `job-group-service` (a new
  app with its own Postgres database, its own API, polling job-service); no cancellation, bulk or
  otherwise, in either (user)
- Bulk submit is a public job-service route that takes an array of ordinary job submissions of any
  job types; their content is the same as a single submission (user)
- Bulk submit is all or nothing: any invalid item rejects the whole request naming the item's
  position, and nothing is stored (user)
- Bulk submit exists to cut latency: one request stores and queues all jobs (user)
- A job is linked to its group by an optional `groupId` on the job submission, stored and returned;
  `GET /v1/jobs` gets a `groupId` filter so a group's jobs are found with one query (user)
- No UI in this change (user)
- The bulk route is `POST /v1/jobs/bulk` with body `{ jobs: [...] }`, answered with HTTP 201
  `{ items: [job, ...] }` in request order (user)
- At most a configured number of jobs per bulk request, default 100; the bulk route has its own
  configured body size limit, default 1 MB, while other routes keep theirs (user)
- `groupId` is a UUID (user)
- More jobs than the configured maximum are rejected with HTTP 400 `VALIDATION_FAILED` naming the maximum (user confirmed assumption)
- An empty array is rejected with HTTP 400 `VALIDATION_FAILED` (user confirmed assumption)
- Validation issues of an item name its position in the field path (e.g. `jobs.3.payload.to`) (user confirmed assumption)
- An item that passes the schema but fails a job-service rule (a flight transit whose departure day is over) also rejects the whole request, naming the item's position (user confirmed assumption)
- Each item gets the same defaults as a single submission (priority, max attempts) (user confirmed assumption)
- A job submitted without `groupId` has `groupId: null`, and every job route returns the field (user confirmed assumption)
- The `groupId` filter takes one value and combines with `status` and `type` (AND); an invalid value is 400 `VALIDATION_FAILED` (user confirmed assumption)
- When the queue is unavailable, bulk submit still answers 201 with all jobs, which stay `pending` (user confirmed assumption)
- Jobs of one bulk request are listed in request order among themselves (the first item is the oldest) (user confirmed assumption)

## Assumed

- [x] More jobs than the configured maximum are rejected with HTTP 400 `VALIDATION_FAILED` naming the maximum - a too-large bulk is a client mistake, like a too-large page
- [x] An empty array is rejected with HTTP 400 `VALIDATION_FAILED` - a bulk of nothing is a client mistake
- [x] Validation issues of an item name its position in the field path (e.g. `jobs.3.payload.to`) - same error body as single submit, the index is part of the field
- [x] An item that passes the schema but fails a job-service rule (a flight transit whose departure day is over) also rejects the whole request, naming the item's position - same all-or-nothing rule
- [x] Each item gets the same defaults as a single submission (priority, max attempts) - items are ordinary submissions
- [x] A job submitted without `groupId` has `groupId: null`, and every job route returns the field - consistent with the other optional fields
- [x] The `groupId` filter takes one value and combines with `status` and `type` (AND); an invalid value is 400 `VALIDATION_FAILED` - a client follows one group at a time
- [x] When the queue is unavailable, bulk submit still answers 201 with all jobs, which stay `pending` - same rule as single submit
- [x] Jobs of one bulk request are listed in request order among themselves (the first item is the oldest) - predictable order in the newest-first list

## Open questions

- [x] Path and body shape of the bulk route
- [x] The configured maximum number of items per bulk request (default value), and how it relates to the request body size limit (today 100 KB for every route)
- [x] Format of `groupId`
