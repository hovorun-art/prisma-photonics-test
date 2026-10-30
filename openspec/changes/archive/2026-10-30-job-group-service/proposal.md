# Proposal

## Why

The task's Batch job type is answered in this project by job groups: a client submits many real
jobs at once (for example an email campaign) and follows them as one group. `job-bulk-create`
gave job-service the pieces (bulk submit, an opaque `groupId` on every job, a `groupId` filter on
the job query); nothing yet owns the group itself: its identity, its counts and whether it has
finished, completed or failed. This change adds that owner as its own service, so the group logic
stays out of job-service and could be deployed, scaled or replaced on its own.

## What Changes

- A new backend app, `apps/job-group-service`, separate from job-service and
  job-execution-service, with its own Postgres schema in the shared database (own Prisma schema and migrations) and its
  own public REST API (create, get one, list, delete). API only, no UI. One instance.
- A group is one object with an id, stats and a state; it is created empty, and its id is the
  `groupId` the client gives the child jobs it submits to job-service. A client whose submit fails
  deletes the still-empty group.
- A group's status is `running` until every child job has finished; then `completed` if all
  children completed, `failed` if any child failed.
- job-group-service learns the children's states by polling job-service at a configured interval
  through the public job query (`GET /v1/jobs?groupId=<uuid>`, paged with `limit`/`offset`,
  answered with `{ items, total }`).
- No cancellation: a failed child does not cancel the rest, and there is no bulk cancel, retry or
  delete of a group's jobs (deleting the group object itself is allowed only while it is empty).
- Duplicate child jobs after a crash or a retried request are not this service's concern (child
  jobs are ordinary jobs); `DECISIONS.md` says so.
- Health check, graceful shutdown, OpenAPI docs and the shared error body, like the other
  backends; the app joins `docker compose` and `npm run dev`.

## Capabilities

### New Capabilities

- `job-groups`: creating a job group, reading it with its counts and status, and how the status
  follows the child jobs.

### Modified Capabilities

- `system-health`: job-group-service answers its health check, shuts down gracefully and
  publishes its API documentation.
- `api-errors`: the uniform error body and codes apply to job-group-service's API as well.

## Impact

- New `apps/job-group-service` (NestJS, `domain/` `infra/` `app/` layers, Prisma schema and
  migrations, per-app e2e tests).
- `packages/contracts`: the group schemas (create request, group response, status).
- `packages/kernel`: new error codes `JOB_GROUP_NOT_FOUND` and `JOB_GROUP_NOT_EMPTY`.
- `docker-compose.yml`, `Dockerfile`, `.env.example`, `npm run dev`: the group schema, its migrations, and the new service.
- Depends on `job-bulk-create` (bulk submit, `groupId`, the `groupId` filter), which is not yet on
  the main branch.
- Docs: `README.md`, `DECISIONS.md` (job groups instead of the Batch job type, polling, an event topic as the next step, no
  cancellation, duplicates after a crash), `docs/roadmap/06-bulk-operations.md`.
