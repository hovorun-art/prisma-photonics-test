# Decisions: job-group-service

## Decided

- Job groups replace the task's Batch job type: a client submits many real jobs at once (for example an email campaign) and follows them as one group (user)
- API only, no UI (user)
- job-group-service is a new app (`apps/job-group-service`), separate from job-service and job-execution-service, with its own data store (own Prisma schema and migrations) and its own public REST API (user)
- A group is one object with an id, stats and a state; its id is the `groupId` of its child jobs (user)
- A group's status is `running` until every child job has finished; then `completed` if all children completed, `failed` if any child failed (user)
- job-group-service learns the children's states by polling job-service at a configured interval through `GET /v1/jobs?groupId=<uuid>` (one value, combines with `status`/`type`, paged with `limit`/`offset`, answered with `{ items, total }`) (user)
- No cancellation anywhere: no cancelling of the remaining children when one fails, no bulk cancel, retry or delete (user)
- Duplicate child jobs after a crash or a retried request are not this service's concern (child jobs are real jobs); `DECISIONS.md` states this honestly (user)
- Creating a group (`POST /v1/groups`) takes no jobs: it creates the empty group object and returns it with its id (user)
- The client submits the child jobs to job-service itself (`POST /v1/jobs/bulk` or single submit, with `groupId` = the group id); job-group-service never submits jobs (user)
- If the client's submit fails, the client deletes the group with `DELETE /v1/groups/:id`, allowed only while job-service reports no children for it (user)
- A child cancelled on its own through job-service counts as finished but not completed, so the group ends `failed` (user)
- The group remembers the highest child count job-service ever reported for it; children missing later (deleted through job-service before the group finished) count as failed (user)
- A group with no children stays `running`; once it has at least one child and all of its children are finished it gets its final status, and jobs added after that do not change it (user)
- Polling stays in this change; an event topic (job-service publishes child status changes, the group updates itself) is recorded in `DECISIONS.md` as the next step, with its trade-offs (user)
- `GET /v1/groups/:id` returns the group as job-group-service stored it; its stats (`total`, `failed`, and the successful ones) are refreshed by the polling interval, not on the request (user)
- job-group-service runs as a single instance; polling is not shared between instances (user)
- The group API has create, get one, get many (`GET /v1/groups`) and delete (user)
- The default poll interval is 2 seconds (configured) (user)
- Its data lives in the same Postgres container and database as job-service, in its own Postgres schema (not a second database or container) (user)
- Planned now on this branch; job-bulk-create (`groupId` on jobs, the `groupId` filter) is integrated when it lands on master, before this change's code needs it end to end (user)
- The group API has no authentication, like job-service's public API (user confirmed assumption)
- job-group-service calls only job-service's public API (the job query), not `/internal` (user confirmed assumption)
- The stats are `total` (the highest child count seen), `completed` (children completed) and `failed` (children failed, cancelled or missing); the successful ones are named `completed` to match the job status (user confirmed assumption)
- A group carries `createdAt`, `updatedAt`, `checkedAt` (last successful poll, null before the first) and `finishedAt` (null while running) (user confirmed assumption)
- The group response does not list its child jobs; a client lists them with `GET /v1/jobs?groupId=<id>` on job-service (user confirmed assumption)
- Once a group is `completed` or `failed` it is no longer polled and its stats and status no longer change (user confirmed assumption)
- An unknown group id answers 404 with a new error code `JOB_GROUP_NOT_FOUND`; a malformed id answers 400 `VALIDATION_FAILED` (user confirmed assumption)
- job-group-service has the same health check, graceful shutdown, Swagger docs at `/docs`, error filter and structured logging as the other backends (user confirmed assumption)
- Its port is configured by `JOB_GROUP_SERVICE_PORT`, default 3002, published in docker compose (user confirmed assumption)
- It joins `docker compose up` (with its own migrate step) and `npm run dev` (user confirmed assumption)
- Deleting a group that has children answers 409 with a new error code `JOB_GROUP_NOT_EMPTY`; when job-service cannot be reached it answers 503 `JOB_SERVICE_UNAVAILABLE`, and a successful delete answers 204 (user confirmed assumption)
- `GET /v1/groups` is paged like the job query (`limit`/`offset`, its own configured default and maximum page size, newest first, `{ items, total }`) with no filters (user confirmed assumption)
- When a poll fails (job-service unreachable), the group keeps its last stats and status and is tried again at the next interval; the failure is logged (user confirmed assumption)
- A child that is `scheduled`, `pending` or `processing` counts toward `total` only; the group is finished when `completed + failed = total` and `total > 0` (user confirmed assumption)
- The poll loop uses `@nestjs/schedule` (7.1M weekly downloads, v12.0.2 of 2026-09, own TypeScript types, ESM; chosen over set-interval-async, toad-scheduler and a kernel Sleeper loop) (user)

## Assumed

- [x] The group API has no authentication, like job-service's public API - same trust model as the rest of the public API
- [x] job-group-service calls only job-service's public API (the job query), not `/internal` - it is a client like any other
- [x] The stats are `total` (the highest child count seen), `completed` (children completed) and `failed` (children failed, cancelled or missing); the successful ones are named `completed` to match the job status - one word per outcome across the API
- [x] A group carries `createdAt`, `updatedAt`, `checkedAt` (last successful poll, null before the first) and `finishedAt` (null while running) - same timestamp style as a job; `checkedAt` tells how fresh the stats are
- [x] The group response does not list its child jobs; a client lists them with `GET /v1/jobs?groupId=<id>` on job-service - no duplicated job data
- [x] Once a group is `completed` or `failed` it is no longer polled and its stats and status no longer change - a final state is final, like a job's
- [x] An unknown group id answers 404 with a new error code `JOB_GROUP_NOT_FOUND`; a malformed id answers 400 `VALIDATION_FAILED` - same pattern as jobs
- [x] job-group-service has the same health check, graceful shutdown, Swagger docs at `/docs`, error filter and structured logging as the other backends - one way of running services
- [x] Its port is configured by `JOB_GROUP_SERVICE_PORT`, default 3002, published in docker compose - next free port after the two backends
- [x] It joins `docker compose up` (with its own migrate step) and `npm run dev` - the whole system starts with one command
- [x] Deleting a group that has children answers 409 with a new error code `JOB_GROUP_NOT_EMPTY`; when job-service cannot be reached it answers 503 `JOB_SERVICE_UNAVAILABLE`, and a successful delete answers 204 - same status style as the job routes
- [x] `GET /v1/groups` is paged like the job query (`limit`/`offset`, its own configured default and maximum page size, newest first, `{ items, total }`) with no filters - one paging style across the API
- [x] When a poll fails (job-service unreachable), the group keeps its last stats and status and is tried again at the next interval; the failure is logged - polling is self-healing
- [x] A child that is `scheduled`, `pending` or `processing` counts toward `total` only; the group is finished when `completed + failed = total` and `total > 0` - follows from the decided rules

## Open questions

- [x] What does creating a group take: the array of jobs (job-group-service submits them to job-service in bulk, tagged with the new group id), or nothing (the client gets an id and submits the jobs to job-service itself)?
- [x] When the group's jobs cannot be submitted (job-service down or rejects an item), what does the client get, and is a group stored?
- [x] How does a `cancelled` child (cancelled on its own through job-service) count for the group status?
- [x] What if a finished child is deleted through job-service before the group has finished?
- [x] Does `GET` of a group return the last polled snapshot, or ask job-service live?
- [x] With several job-group-service instances, how is polling shared (each instance polls every running group, or instances claim groups so each is polled by one)?
- [x] Is there a list route for groups (`GET /v1/groups`, paged), or only create and get?
- [x] Maximum number of jobs per group (moot: job-group-service does not submit jobs; the client's bulk calls follow job-service's limits)
- [x] Default poll interval
- [x] Own database: a second database on the same Postgres server, or a separate Postgres container?
- [x] Branch base: job-bulk-create is not on master yet; base this branch on it now, or wait for its merge before `/apply`?
