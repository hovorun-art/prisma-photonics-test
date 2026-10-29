# Decisions: project-scaffold

## Decided

- Monorepo with npm workspaces; Node 26 (`node:26-alpine`), fall back to 24 if a core library does not support it (user)
- Apps: `job-service` (NestJS REST API, owns the Job aggregate), `job-execution-service` (NestJS, runs jobs), `job-ui` (React + Vite; renamed from `web`) (user)
- `job-execution-service` scales on its own with `docker compose up --scale job-execution-service=N`, plus in-process concurrency (user)
- Postgres via Prisma is the source of truth; Redis holds the queue (BullMQ behind our own queue interface) (user)
- Contracts as Zod schemas in `packages/contracts`, shared by backend and UI; REST + OpenAPI (Swagger), not tRPC (user)
- DDD + onion per module, interfaces first with DI tokens, modules talk only through public interfaces (user)
- Own error classes with stable codes, handled by code, never by message (user)
- job-ui: Tailwind + shadcn/ui, TanStack Query (polling), feature folders (user)
- Strict TypeScript, ESLint + Prettier, Vitest in every workspace, pino structured logging, Conventional Commits (user)
- Health: `GET /health` on job-service reports overall status and the status of Postgres and Redis (unavailable when either is down); each job-execution-service instance writes a heartbeat with a short expiry to Redis and health lists the live instances; `queue-health` later adds queue stats to the same response (user)
- Development: `npm run dev` starts Postgres and Redis in Docker and the apps on the host with hot reload; `docker compose up` runs the full stack (user)
- External cancel only from pending or scheduled; any other status gets a typed error (user; behaviour built in `job-cancel`)
- Retry is the external update failed → pending, not a separate endpoint (user; behaviour built in `job-retry`)
- The internal update method lives under an `/internal` prefix, is hidden from public Swagger and requires a service token from an env var (user)
- Workers wait and retry Redis (and any other dependency) with backoff at startup, and publish their heartbeat only once ready (user)
- Two services: job-service (only service with Postgres access) and job-execution-service (no database access; reads and changes job state only through job-service). A separate service writing the jobs table directly is the shared-database anti-pattern and is ruled out (user)
- job-service has two update methods: an external one for clients, which may change only the status: to cancelled (from pending or scheduled only) or to pending (retry, from failed only), and a separate internal one used by job-execution-service for status, attempts, errors, progress, results and logs. Ideally this would be field-level internal attributes (as in gRPC); a separate method keeps it simple. Record the trade-off in DECISIONS.md (user)
- job-ui skeleton: a blank page with text showing whether the backend is reachable (user)
- Test levels: unit; integration (one adapter with its real dependency, Testcontainers); per-app e2e (each app as a black box over its real interface with its own infrastructure, other apps simulated: job-service with simulated execution heartbeats, job-execution-service with a stub job-service, job-ui with intercepted `/api` calls); contracts through the shared Zod schemas (stubs and fixtures validated against `packages/contracts`, no Pact); system e2e on the full compose stack (user)
- E2E tool: Playwright for job-ui per-app e2e and for system e2e; backend per-app e2e with Vitest (user)
- Locations: per-app e2e in `apps/<app>/test/e2e`; system e2e in its own workspace `tests/system-e2e` (user)
- Scripts: `npm test` runs unit, integration and backend per-app e2e (Stop hook); `npm run test:e2e` runs job-ui Playwright and system e2e on compose (CI and the change verifier, not the Stop hook) (user)
- System e2e calls everything that exists: `GET /health`, the docs route, `/internal/v1/ping` with and without a valid token, job-ui in a browser, scaled execution instances and stopping one (user)
- The scaffold runs no jobs and creates no job tables; it only proves every service starts and connects (user, roadmap)
- One root multi-stage `Dockerfile` with a target per app (the task asks for a `Dockerfile`), used by `docker-compose.yml` (user confirmed assumption)
- Database migrations run by a one-shot `migrate` service in compose that the backend services wait for (user confirmed assumption)
- Ports, URLs and connection strings come from environment variables with a committed `.env.example` (user confirmed assumption)
- Integration tests against real Postgres and Redis use Testcontainers (user confirmed assumption)
- CI (`.github/workflows/checks.yml`) runs on `master`, uses Node 26, runs the existing checks and also builds the Docker images (user confirmed assumption)
- Services shut down gracefully on SIGTERM (close HTTP server, Redis and Postgres connections) (user confirmed assumption)

## Assumed

- [x] One root multi-stage `Dockerfile` with a target per app (the task asks for a `Dockerfile`), used by `docker-compose.yml` - one file to maintain, matches the submission layout
- [x] Database migrations run by a one-shot `migrate` service in compose that the backend services wait for - no race between several instances migrating at once
- [x] Ports, URLs and connection strings come from environment variables with a committed `.env.example` - nothing hardcoded, same images locally and in compose
- [x] Integration tests against real Postgres and Redis use Testcontainers - work the same locally and in CI without a running compose stack
- [x] CI (`.github/workflows/checks.yml`) runs on `master`, uses Node 26, runs the existing checks and also builds the Docker images - catches a broken Dockerfile early
- [x] Services shut down gracefully on SIGTERM (close HTTP server, Redis and Postgres connections) - needed later for crash-recovery tests and clean `docker compose down`

## Open questions

- [x] What does the health endpoint report, and how does job-service know job-execution-service instances are alive?
- [x] How do we develop day to day: everything in Docker, or Postgres/Redis in Docker and the apps on the host with hot reload?
- [x] What does the job-ui skeleton show?
- [x] Where does job execution run? (answered under Decided)
- [x] External cancel: from which statuses (task: pending/scheduled; user mentioned "in progress")?
- [x] Retry of a failed job: how is it requested, now that the external update only allows cancelling?
- [x] How is the internal update method protected from external callers?
