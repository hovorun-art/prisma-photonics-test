# Design

## Context

Two backends exist today. job-service owns the jobs table (Prisma, `apps/job-service/prisma`) and
the public job API; job-execution-service reaches job-service over HTTP (`HttpJobRepository`, fetch
with a timeout, `JobServiceUnavailableError` for network errors, timeouts and 5xx). Both start
through `NestServiceBootstrap` (service-kit) with a list of setup steps, use the service-kit
config, logging, health and Redis modules, and job-service has its own `ErrorResponseFilter`
(with the `HTTP_STATUS_BY_ERROR_CODE` table) and `SwaggerApiDocsSetupStep`. Compose runs one
Postgres container with one database; a one-shot `migrate` service applies job-service's
migrations.

`job-bulk-create` (on its own branch, not yet on master) adds `groupId` to the job contract and the
`groupId` filter to `GET /v1/jobs`. This change codes against that contract and is integrated after
it lands (decisions.md).

See proposal.md for why; requirements are in `specs/job-groups`, `specs/system-health` and
`specs/api-errors`.

## Goals / Non-Goals

**Goals:**
- A third backend built exactly like the other two (layers, bootstrap, filter, docs, health,
  shutdown), with no code copied from job-service: shared pieces move to service-kit or the kernel.
- A poll that costs job-service three cheap count queries per running group, never overlaps itself
  and never changes a finished or deleted group.

**Non-Goals:**
- Several job-group-service instances (decided: single instance); no claiming or leader election.
- Events from job-service (recorded in `DECISIONS.md` as the next step).
- Any change to job-service's behaviour beyond what `job-bulk-create` adds.
- A UI.

## Decisions

### Shared code moves before the new app (no logic written twice)
- `ErrorResponseFilter` and `HTTP_STATUS_BY_ERROR_CODE` move from `apps/job-service/src/app/errors`
  to service-kit (`app/errors/`); `VALIDATION_FAILED_MESSAGE` and the page-limit error
  (`QueryLimitExceededError`) are framework-free and imported by job-service's `domain/`, so they
  move to the kernel (`domain/validation/`) instead; job-service imports them. Their tests move with them. The table stays the one
  place where a code gets its status, now shared by both HTTP services.
- `SwaggerApiDocsSetupStep` moves to service-kit (`infra/docs/`); each app keeps its own params
  constant (`JOB_SERVICE_API_DOCS_PARAMS`, `JOB_GROUP_SERVICE_API_DOCS_PARAMS`).
- `JobServiceUnavailableError` moves from job-execution-service's domain to the kernel
  (`domain/jobs/`), next to `JobNotFoundError`; both clients of job-service throw it.
- `RequestBodySetupStep` stays in job-service: no group route takes a body, and `job-bulk-create`
  edits that file (moving it now would collide). job-group-service turns Nest's body parser off
  (through a `NestServiceBootstrap` option, added if it has none), so a body sent to a group route
  is ignored instead of parsed. Alternative (move the step too and share limits) rejected: more
  churn for routes that read no body.

### Error codes (`packages/kernel`)
`JOB_GROUP_NOT_FOUND` (404) and `JOB_GROUP_NOT_EMPTY` (409) join `ERROR_CODES`, with rows in the
shared status table. `JOB_SERVICE_UNAVAILABLE`'s doc comment widens to "a service could not reach
job-service"; job-group-service answers it with 503 (the existing row).

### Contracts (`packages/contracts/src/groups/job-group.ts`)
- `JOB_GROUPS_ROUTE = '/v1/groups'`.
- `JobGroupStatus = z.enum(['running', 'completed', 'failed'])`.
- `JobGroup = { id: uuid, status, total, completed, failed (non-negative ints), createdAt,
  updatedAt, checkedAt | null, finishedAt | null }` (ISO timestamps like `Job`).
- `JobGroupIdParams = { id: uuid }`.
- `QueryJobGroupsRequest = { limit?: positive int, offset: int >= 0 (default 0) }` (coerced like
  `QueryJobsRequest`); the configured maximum is checked by the service, as job-service does.
- `QueryJobGroupsResponse = { items: JobGroup[], total }`.

### App layout (`apps/job-group-service/src`)
```
domain/config/job-group-service-config.ts   JobGroupServiceConfig + token
domain/database/database.ts                  Database port (ping, close)
domain/groups/job-group-repository.ts        JobGroupRepository: create, get, query, delete,
                                             listRunning, recordCheck
domain/groups/group-child-jobs.ts            GroupChildJobs: count({ groupId }) → { total, completed, failed }
domain/groups/job-group-service.ts           JobGroupService (use cases): create, get, query, delete
domain/groups/job-group-tracker.ts           JobGroupTracker: checkRunning() → { checked, failedChecks }
domain/groups/errors/                        JobGroupNotFoundError, JobGroupNotEmptyError
infra/config/zod-job-group-service-config-parser.ts
infra/bootstrap/job-group-service-bootstrap.ts   JOB_GROUP_SERVICE_SETUP_STEPS
infra/prisma/prisma-database.ts
infra/groups/prisma/prisma-job-group-repository.ts
infra/groups/http/http-group-child-jobs.ts
infra/groups/job-group-service.impl.ts
infra/groups/job-group-tracker.impl.ts
app/app.module.ts, app/prisma/prisma.module.ts
app/groups/job-groups.controller.ts, job-group.dto.ts, job-groups.module.ts
app/groups/job-group-poll.ts                 Nest entry point that runs the tracker on the interval
main.ts
prisma/schema.prisma, prisma/migrations/, prisma.config.ts
test/e2e/{service,errors,groups}.e2e.test.ts, job-group-service-under-test.ts
```
The page-limit error (`QueryLimitExceededError` in job-service) is needed here too: it moves to
the kernel in group 1 and both apps use it, instead of a copy.

### Config
From the service-kit base (`NODE_ENV`, `LOG_LEVEL`, port) plus: `JOB_GROUP_SERVICE_PORT` (3002),
`DATABASE_URL` (with `?schema=job_groups`), `JOB_SERVICE_URL`, `JOB_GROUP_POLL_INTERVAL_MS`
(2000), `JOB_GROUP_POLL_BATCH_SIZE` (100, running groups read per page of a tick),
`JOB_SERVICE_TIMEOUT_MS` (5000), `JOB_GROUP_QUERY_DEFAULT_LIMIT` (20) and
`JOB_GROUP_QUERY_MAX_LIMIT` (100). job-group-service uses no Redis and no service token; if the
base env schema requires them, it is split so a service without Redis can use it.

### Data store: own Postgres schema in the shared database
Prisma schema `apps/job-group-service/prisma/schema.prisma`, table `job_groups` in the Postgres
schema `job_groups` (decided: same container and database, own schema). The URL carries
`?schema=job_groups`, so `prisma migrate deploy` creates the schema and keeps its own
`_prisma_migrations` table there; `PrismaPg` gets `{ schema: 'job_groups' }`. job-service's tables
in `public` are untouched and neither app reads the other's schema.

```
job_groups(id uuid pk default gen_random_uuid(), status job_group_status, total int, completed int,
           failed int, created_at, updated_at, checked_at null, finished_at null  -- timestamptz(3))
index (created_at desc, id desc)            list order, stable offset paging
index (status, checked_at asc nulls first)  running groups, least recently checked first
```

### Counting children (`HttpGroupChildJobs`)
Three calls to job-service's public `GET /v1/jobs`, all with `groupId` and `limit=1`, reading only
`total`: no filter → reported total; `status=completed` → completed; `status=failed&status=cancelled`
→ failed. The calls run in parallel under `JOB_SERVICE_TIMEOUT_MS`; network errors, timeouts and
5xx throw the kernel `JobServiceUnavailableError`; any other non-2xx or a body that does not parse
as `QueryJobsResponse` is unexpected and thrown as is (logged by the tracker, the group is retried
next tick). Alternative (page through every child and count in memory) rejected: cost grows with
the group size. The three counts are not one snapshot (see Risks).

### Status rule (`JobGroupTrackerImpl`)
Per running group, from the stored row and the reported counts:
- `total = max(stored.total, reported.total)`
- `completed = reported.completed`
- `failed = reported.failed + (total - reported.total)` (missing children count as failed)
- finished when `total > 0` and `completed + failed = total`; then `status = completed` if
  `completed = total`, else `failed`, and `finishedAt = clock.now()`
- `checkedAt = clock.now()`

`recordCheck` writes with `UPDATE ... SET total = GREATEST(total, $total), ... WHERE id = $id AND
status = 'running'`, so a group deleted or finished in the meantime is not changed or recreated.
The tracker reads running groups a page at a time (`listRunning`, ordered by `checked_at nulls
first`), checks them one after another, and catches each group's failure on its own: it logs
`groupId` and the error and moves on, so one bad answer does not hold back the rest. Time comes
from the kernel `Clock`.

### Poll loop (`@nestjs/schedule`, decided)
`ScheduleModule.forRoot()` in the app module. `JobGroupPoll` (app layer, `OnApplicationBootstrap`)
registers an interval of `pollIntervalMs` through `SchedulerRegistry` (the interval is runtime
config, so not the `@Interval` decorator). Each tick calls `tracker.checkRunning()` unless the
previous tick is still running (a private in-flight flag; `@nestjs/schedule` does not await the
handler). On shutdown (`OnApplicationShutdown`) it deletes the interval and awaits the tick in
flight before the database closes, so the spec's "stops polling, closes its connections" holds.

### Group use cases (`JobGroupServiceImpl`)
- `create`: repository insert with zero stats; the id comes from Postgres.
- `get`: repository read; `JobGroupNotFoundError` when missing. Never calls job-service.
- `query`: checks `limit` against the configured maximum (`VALIDATION_FAILED`, issue on `limit`),
  default limit from config, newest first.
- `delete`: 404 if the group is missing; then `childJobs.count` (a `JobServiceUnavailableError`
  propagates → 503); `total > 0` → `JobGroupNotEmptyError` (409, details `{ id, total }`);
  otherwise repository delete → 204.

### HTTP (`JobGroupsController`)
`POST /v1/groups` (201), `GET /v1/groups` (200), `GET /v1/groups/:id` (200), `DELETE
/v1/groups/:id` (204), Zod DTOs from the contracts, Swagger docs with error responses. Setup steps:
Swagger only (`JOB_GROUP_SERVICE_SETUP_STEPS`). The shared `ErrorResponseFilter` maps unknown
routes and validation failures as in job-service.

### Running it
- `Dockerfile`: a `job-group-service` runtime stage like job-service's, and a
  `job-group-service-migrate` stage (`prisma migrate deploy` in `apps/job-group-service`).
- `docker-compose.yml`: `job-group-service-migrate` (one-shot, after postgres is healthy) and
  `job-group-service` (port 3002 published, `JOB_SERVICE_URL=http://job-service:3000`, depends on
  its migrate step and job-service's health, healthcheck on `/health`).
- `npm run dev`: a fourth `concurrently` entry; the app's `dev` script runs `prisma migrate dev`
  then `nest start --watch`, like job-service. `.env.example` gains the variables above.
- Root `build` script includes the new workspace.

### Tests
- Unit: tracker rule (every status and counting scenario, failure isolation, `recordCheck` input),
  service impl (each use case and error), poll entry point (no overlap, stop on shutdown, fake
  timers), config parser.
- Integration: `PrismaJobGroupRepository` against a Testcontainers Postgres migrated with the app's
  migrations into the `job_groups` schema (including the conditional `recordCheck`);
  `HttpGroupChildJobs` against a local `node:http` server, as `HttpJobRepository` is tested
  (query strings, timeout, 5xx, unparseable body).
- Per-app e2e: real Postgres, `GroupChildJobs` mocked at its port with `mockDeep`, a short
  configured poll interval and `expect.poll` for the polling scenarios; `service` (health, docs,
  shutdown closes the database once and stops polling), `errors` (unknown route, unexpected
  failure via a spied provider), `groups` (every `job-groups` scenario).
- System e2e (`tests/system-e2e`): create a group, bulk-submit jobs with its `groupId` to
  job-service, wait until the group is `completed`; needs `job-bulk-create` merged.

### Module boundaries for the task groups
1. Shared extraction (service-kit filter and docs step; kernel errors, validation message and codes)
   with job-service and job-execution-service switched over, all checks green.
2. Contracts (`groups/job-group.ts`).
3. App skeleton: workspace, config, bootstrap, Prisma schema and migration, database module,
   health, docs, error filter, service e2e.
4. Repository adapter and child-jobs adapter (integration tests): independent of each other.
5. Use cases and tracker (unit tests, mocked ports).
6. HTTP controller and poll entry point, per-app e2e.
7. Docker, compose, dev script, `.env.example`.
8. Integration with `job-bulk-create`, the system e2e, and docs (`README.md`, `DECISIONS.md`,
   roadmap).

## Risks / Trade-offs

- [The three counts are read in three requests, not one snapshot] → a child finishing between
  them can be counted in neither or in "finished" while the total was read before it existed.
  Finished statuses are final and disjoint, so `completed + failed` can only reach `total` early if
  a child is added between the calls; the total call is made last to rule that out (a child added
  then raises `total`). "Neither" only delays finishing to the next tick.
- [A child is deleted before any poll counted it] → it never enters `total`; the highest-count rule
  covers deletions after the first sighting only. Documented in `DECISIONS.md`.
- [Deleting a group races with the client's own submit] → the delete sees no children and removes
  the group while the bulk lands a moment later; those jobs carry the id of a deleted group.
  Accepted: the client deletes only after its own submit failed; documented.
- [Duplicate child jobs after a crash or a retried client request] → they are real jobs and count
  in the group; not this service's concern (decided), stated in `DECISIONS.md`.
- [A group finishes as soon as the children seen so far are done, and later jobs are ignored] →
  follows the decided rule; a client submitting in several requests must submit the next one before
  the first finishes. Documented.
- [Single instance] → two instances would both poll every group; the conditional `recordCheck`
  keeps that correct but doubles job-service load. Documented; claiming with
  `FOR UPDATE SKIP LOCKED` is the noted next step.
- [Poll load: three queries per running group per interval] → bounded by the interval; the event
  topic in `DECISIONS.md` removes it.
- [`groupId` filter missing until `job-bulk-create` lands] → job-service would strip the unknown
  query parameter and count all jobs; the adapter meets a real job-service only in the system e2e,
  which runs after the integration (group 8).
- [Moving the filter and docs step out of job-service] → a pure move with its tests, done first,
  checks green before the new app starts.

## Migration Plan

- New Postgres schema `job_groups`, created by the app's first migration; job-service's schema is
  untouched. Rollback: `DROP SCHEMA job_groups CASCADE` and remove the two compose services.
- Start order in compose: postgres → both migrate steps → job-service → job-group-service.
