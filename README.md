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

curl -i http://localhost:3000/no-such-route
# HTTP/1.1 404 Not Found
# {"code":"ROUTE_NOT_FOUND","message":"...","details":{}}
```

Every error the API returns has the same body: `code` (from a closed list), `message`, `details`.
The codes today: `INTERNAL_UNAUTHORIZED` (401), `ROUTE_NOT_FOUND` (404), `VALIDATION_FAILED` (400,
also for a body that is not valid JSON), `PAYLOAD_TOO_LARGE` (413, the limit is in `details`; set
with `JOB_SERVICE_BODY_LIMIT_BYTES`) and `INTERNAL_ERROR` (500).

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
integration and e2e tests of both backends share one set of helpers in `tests/support/` (counts
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
```

- **job-service** (NestJS) owns job state; it is the only service with database access.
- **job-execution-service** (NestJS) takes jobs from the queue (BullMQ on Redis), runs them (email
  for now) and reports each step through job-service's internal API; it has no database access.
  It scales horizontally and runs several jobs per instance (`JOB_EXECUTION_CONCURRENCY`).
- **job-ui** (React + Vite) is served by nginx, which forwards `/api` to job-service. Pages:
  `/jobs` (list, also the start page), `/jobs/new` (submit an email job), `/jobs/:id` (one job);
  list and job page refresh by polling.
- **Shared packages:** `packages/contracts` (Zod schemas for every request, response and error),
  `packages/kernel` (framework-free ports and base classes), `packages/service-kit` (bootstrap,
  config, logging, Redis and health shared by both backends).
- Each backend is split into `domain/` (interfaces), `infra/` (implementations) and `app/`
  (NestJS wiring), so any part can later move into its own service.

Health checks report only their own process (`GET /health` → 200), never related services, so
services that wait for each other cannot deadlock. See [DECISIONS.md](DECISIONS.md) for this and
the other trade-offs.
