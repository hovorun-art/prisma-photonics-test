# Milestone 6: Job groups

A client submits many jobs at once, of any types (for example an email campaign), and follows them
as one group. This is the project's answer to the task's Batch job: the items of a group are real
jobs, each with its own status, retries and recovery. job-ui shows the groups (`job-group-ui`).

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `job-bulk-create` | Bulk submit in job-service (`POST /v1/jobs/bulk`, all or nothing, one transaction and one queue call), an optional `groupId` on every job, and a `groupId` filter on the job query | `job-list-filters-service` |
| `job-group-service` | A new app with its own Postgres schema and API: create an empty group (the client submits its jobs with the group's id and deletes the still-empty group if that fails), get and list groups with their total, completed and failed counts; it polls job-service and is `completed` when every child completed, `failed` when any child failed or was cancelled | `job-bulk-create` |
| `job-group-ui` | job-ui pages for groups: a groups list like the jobs list, and a group page from the design "BatchJob" with the group's progress, one cell per child job and its details; read only | `job-group-service` |

No bulk cancel, retry, update or delete, and no cancellation of a group's remaining jobs.

## Open questions

- [x] Limits on items per request; whether bulk submit is all-or-nothing or per item. (Answered in
  `job-bulk-create`: all or nothing; a configured maximum of jobs per request, default 100; one body
  limit for every route, `JOB_SERVICE_BODY_LIMIT_BYTES`, its default raised to 1 MB.)
- [x] job-group-service: what happens when the group is stored but the bulk call fails (retry or mark
  the group failed); polling with several instances and after a restart. (Answered in
  `job-group-service`: the group is created empty and the client submits the jobs, then deletes the
  still-empty group if its submit fails; one instance, whose poll reads the stored running groups
  again after a restart.)
