# Job Queue Service

A background job processing system: an API accepts jobs, workers take them from a queue and run
them, Postgres keeps their state and a web UI shows them. Built as an interview task; design
trade-offs are in [DECISIONS.md](DECISIONS.md), AI usage in `AI_USAGE.md`.

> Status: email jobs run end to end: submit from the UI or the API, a job-execution-service
> instance picks the job from the queue and runs it, and the job ends `completed` with a mock
> message id. job-ui lists jobs, shows a job, submits email jobs and deletes finished ones. Next
> steps are in [docs/roadmap/](docs/roadmap/). The full API is documented at
> http://localhost:3000/docs.

## Run it

Requirements: Docker (with Compose v2). For local development also Node 26 and npm.

```bash
cp .env.example .env            # optional: compose has the same defaults built in
docker compose up --build --wait
```

| Service | URL |
|---|---|
| job-service API | http://localhost:3000 |
| API docs (Swagger) | http://localhost:3000/docs |
| job-group-service API | http://localhost:3002 |
| job-group-service docs | http://localhost:3002/docs |
| job-ui | http://localhost:8080 |

Scale the workers: `docker compose up --wait --scale job-execution-service=3`.
Stop and remove everything: `docker compose down -v`.

Local development (Postgres and Redis in Docker, the apps on the host with hot reload):

```bash
npm ci
npm run dev        # reads .env.example; a .env next to it overrides any value
```

`npm run dev` leaves Postgres and Redis running in Docker; stop them with
`docker compose stop postgres redis`.

## Try it

```bash
curl -i http://localhost:3000/health
# HTTP/1.1 200 OK
# {"status":"ok"}

# Submit an email job (priority and maxAttempts are optional)
curl -s -X POST http://localhost:3000/v1/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"email","payload":{"to":"ada@example.com","subject":"Hello","body":"Hi Ada"}}'
# {"id":"<uuid>","status":"pending","priority":5,"attempts":0,"maxAttempts":3,...,"type":"email",...}

# Read it back: within a few seconds it is "completed" with a result {"messageId":"<uuid>"}
curl -s http://localhost:3000/v1/jobs/<uuid>

# Query the newest jobs
curl -s 'http://localhost:3000/v1/jobs?limit=20&offset=0'
# {"items":[...],"total":1}

# Only failed or cancelled webhook jobs (repeat a filter for several values; total counts matches)
curl -s 'http://localhost:3000/v1/jobs?status=failed&status=cancelled&type=webhook'

# Submit several jobs at once, tied to one group (all are stored, or none if any item is invalid)
curl -s -X POST http://localhost:3000/v1/jobs/bulk \
  -H 'content-type: application/json' \
  -d '{"jobs":[
    {"type":"email","payload":{"to":"ada@example.com","subject":"Hello","body":"Hi Ada"},"groupId":"6f1c2a52-8d1e-4b7a-9c3f-2e5d8a7b1c40"},
    {"type":"email","payload":{"to":"alan@example.com","subject":"Hello","body":"Hi Alan"},"groupId":"6f1c2a52-8d1e-4b7a-9c3f-2e5d8a7b1c40"}
  ]}'
# {"items":[{"id":"<uuid>","status":"pending",...,"groupId":"6f1c2a52-..."},{...}]}

# The jobs of that group
curl -s 'http://localhost:3000/v1/jobs?groupId=6f1c2a52-8d1e-4b7a-9c3f-2e5d8a7b1c40'

# Follow jobs as one group (job-group-service, port 3002): create an empty group, submit its jobs
# to job-service with the group's id as groupId, then read the group
curl -s -X POST http://localhost:3002/v1/groups
# {"id":"<group-id>","status":"running","total":0,"completed":0,"failed":0,"checkedAt":null,...}
curl -s http://localhost:3002/v1/groups/<group-id>
# Every 2 s it counts the group's jobs in job-service: running until all are finished, then
# "completed" if all completed, "failed" if any failed or was cancelled
# {"id":"<group-id>","status":"completed","total":2,"completed":2,"failed":0,"finishedAt":"...",...}
curl -s 'http://localhost:3002/v1/groups?limit=10'
# If the submit failed, delete the still-empty group (409 JOB_GROUP_NOT_EMPTY once it has jobs)
curl -i -X DELETE http://localhost:3002/v1/groups/<group-id>
# Queue statistics: jobs pending, processing and scheduled now, completed and failed in the last
# day, and jobs completed per minute over the last 5 minutes (both windows are configurable)
curl -s http://localhost:3000/v1/stats
# {"pending":0,"processing":0,"scheduled":0,"recent":{"windowMinutes":1440,"completed":1,"failed":0},
#  "throughput":{"windowMinutes":5,"perMinute":0.2},
#  "counts":{"status":{"scheduled":0,"pending":0,"processing":0,"completed":1,"failed":0,"cancelled":0},
#            "type":{"email":1,"webhook":0,"flight-transit":0}}}

# Job counts for the jobs list filters, faceted: with type=webhook the counts per status cover only
# webhook jobs; with status=failed the counts per type cover only failed jobs (one value each)
curl -s 'http://localhost:3000/v1/stats?status=failed&type=webhook'

curl -i http://localhost:3000/no-such-route
# HTTP/1.1 404 Not Found
# {"code":"ROUTE_NOT_FOUND","message":"...","details":{}}
```

Every error the API returns has the same body: `code` (from a closed list), `message`, `details`.
The codes today: `INTERNAL_UNAUTHORIZED` (401), `ROUTE_NOT_FOUND` (404), `VALIDATION_FAILED` (400,
also for a body that is not valid JSON, an invalid bulk item and more jobs than
`JOB_SERVICE_BULK_MAX_JOBS`), `PAYLOAD_TOO_LARGE` (413, the limit is in `details`; set with
`JOB_SERVICE_BODY_LIMIT_BYTES`, default 1 MB) and `INTERNAL_ERROR` (500); job-group-service adds
`JOB_GROUP_NOT_FOUND` (404), `JOB_GROUP_NOT_EMPTY` (409) and `JOB_SERVICE_UNAVAILABLE` (503, when it
cannot reach job-service to check a delete).

## Tests

```bash
npm test            # unit, integration and per-app e2e (needs Docker for Testcontainers)
npm run test:e2e    # job-ui in a browser + system e2e against the full compose stack
npm run typecheck
npm run lint
```

Test levels: unit tests next to the code; integration tests (`*.int.test.ts`) run one adapter
against a real Postgres or Redis; per-app e2e tests (`apps/<app>/test/e2e/`) run each app as a black
box; the system e2e (`tests/system-e2e/`) starts the whole stack with two workers. Request and
response shapes are shared Zod schemas, so stubs and the real API cannot drift apart. The
integration and e2e tests of the backends share one set of helpers in `tests/support/` (counts
Redis and Postgres connections, migrates test databases); it is test-only and never part of an
image.

## Architecture

```
            ┌──────────┐   /api    ┌──────────────┐      ┌──────────┐
 browser ──►│  job-ui  │──────────►│ job-service  │─────►│ Postgres │
            │ (nginx)  │           │ REST + docs  │      └──────────┘
            └──────────┘           └──────┬───────┘
                                          │ queue          ┌───────┐
                                          └───────────────►│ Redis │
                                ┌───────────────────────┐  └───┬───┘
                                │ job-execution-service │◄─────┘
                                │  (N instances)        │
                                └───────────────────────┘
            ┌───────────────────┐  polls GET /v1/jobs?groupId=
 clients ──►│ job-group-service │──────────────► job-service
            │ (one instance)    │──────────────► Postgres, schema job_groups
            └───────────────────┘
```

- **job-service** (NestJS) owns job state; it is the only service with access to the jobs table.
- **job-group-service** (NestJS) follows groups of jobs (the project's answer to the Batch job): a
  group is created empty, the client submits its jobs to job-service with the group's id, and the
  service polls job-service's public job query to count them and set the group's status. Its data
  is in its own Postgres schema; it is API only and runs as one instance.
- **job-execution-service** (NestJS) takes jobs from the queue (BullMQ on Redis), runs them (email
  for now) and reports each step through job-service's internal API; it has no database access.
  It scales horizontally and runs several jobs per instance (`JOB_EXECUTION_CONCURRENCY`).
- **job-ui** (React + Vite) is served by nginx, which forwards `/api` to job-service. Pages:
  `/jobs` (list, also the start page), `/jobs/new` (submit an email job), `/jobs/:id` (one job);
  list and job page refresh by polling.
- **Shared packages:** `packages/contracts` (Zod schemas for every request, response and error),
  `packages/kernel` (framework-free ports and base classes), `packages/service-kit` (bootstrap,
  config, logging, Redis, health, the error filter and the docs setup shared by the backends).
- Each backend is split into `domain/` (interfaces), `infra/` (implementations) and `app/`
  (NestJS wiring), so any part can later move into its own service.

Health checks report only their own process (`GET /health` → 200), never related services, so
services that wait for each other cannot deadlock. See [DECISIONS.md](DECISIONS.md) for this and
the other trade-offs.
