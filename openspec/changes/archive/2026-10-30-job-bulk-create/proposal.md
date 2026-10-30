# Proposal

## Why

The task's Batch job ("processes multiple items") is answered in this project by job groups: a
client submits many real jobs at once (for example an email campaign) and follows them as one
group, through a separate job-group-service (next change). That service, and any other client,
needs job-service to accept many jobs in one request instead of one request per job, to cut the
latency of submitting a group, and needs a way to tag and find the jobs of one group.

## What Changes

- A public bulk submit route in job-service: the body is an array of ordinary job submissions (any
  job types), the answer lists the created jobs in the order of the request.
- Bulk submit is all or nothing: if any item is invalid, the request is rejected with an error that
  names the item's position, and no job is stored.
- Every job submission (single and bulk) accepts an optional `groupId`, stored with the job and
  returned on every job; job-service does not interpret it.
- `GET /v1/jobs` gets a `groupId` filter that combines with the status and type filters.
- Jobs created in bulk are put on the queue like single submissions; if the queue is unavailable,
  the jobs are still stored and stay `pending`.
- Roadmap: job groups replace the task's Batch job type (`batch-job` leaves milestone 3); milestone 6
  becomes `job-bulk-create` and `job-group-service`, with no bulk cancel, retry, update or delete.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `job-management`: adds bulk submission, the optional `groupId` on submitted jobs and the
  `groupId` filter of the job query.

## Impact

- `packages/contracts`: the bulk submit request and response, `groupId` on the create request and
  on the Job, the `groupId` query parameter.
- `apps/job-service`: a new route on the jobs controller, a bulk create on `JobService`,
  `JobRepository` (one transaction) and `JobQueue` (one bulk enqueue), a `group_id` column with an
  index (Prisma migration), the query filter, OpenAPI docs.
- job-ui and job-execution-service: no behaviour change (the Job type gains a field).
- Docs: `docs/roadmap/` (milestones 3 and 6), `DECISIONS.md` (job groups instead of the Batch job
  type; bulk submit atomicity), `README.md` (example request).
