# Milestone 6: Job groups

A client submits many jobs at once, of any types (for example an email campaign), and follows them
as one group. This is the project's answer to the task's Batch job: the items of a group are real
jobs, each with its own status, retries and recovery. API only, no UI.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `job-bulk-create` | Bulk submit in job-service (`POST /v1/jobs/bulk`, all or nothing, one transaction and one queue call), an optional `groupId` on every job, and a `groupId` filter on the job query | `job-list-filters-service` |
| `job-group-service` | A new app with its own Postgres database and API: create a group from an array of jobs (one bulk call tagging them with the group's id), get a group with counts per child status; it polls job-service and is `completed` when every child completed, `failed` when any child failed | `job-bulk-create` |

No bulk cancel, retry, update or delete, and no cancellation of a group's remaining jobs.

## Open questions

- [x] Limits on items per request; whether bulk submit is all-or-nothing or per item. (Answered in
  `job-bulk-create`: all or nothing; a configured maximum of jobs per request, default 100, and the
  bulk route's own body limit, default 1 MB.)
- [ ] job-group-service: what happens when the group is stored but the bulk call fails (retry or mark
  the group failed); polling with several instances and after a restart.
