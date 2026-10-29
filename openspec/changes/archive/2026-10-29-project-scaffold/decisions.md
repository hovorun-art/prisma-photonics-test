# Decisions: project-scaffold

## Decided

- Monorepo with npm workspaces; Node 26 (`node:26-alpine`), fall back to 24 if a core library does not support it (user)
- Apps: `job-service` (NestJS REST API, owns the Job aggregate), `job-execution-service` (NestJS, runs jobs), `job-ui` (React + Vite; renamed from `web`) (user)
- `job-execution-service` scales on its own with `docker compose up --scale job-execution-service=N`, plus in-process concurrency (user)
- Postgres via Prisma is the source of truth; Redis holds the queue (BullMQ behind our own queue interface) (user)
- Contracts as Zod schemas in `packages/contracts`, shared by backend and UI; REST + OpenAPI (Swagger), not tRPC (user)
- Code structure, layers first: each app's `src/` has `domain/` (interfaces with their Request/Response types and DI token, value types, domain errors; no logic, no framework imports), `infra/` (every implementation) and `app/` (NestJS entry points and wiring); features are subfolders inside each layer, deeper subfolders when they divide code logically; features use each other only through `domain/` interfaces and tokens (user)
- Class rules: every class implements an interface (or extends a base class that does); no free functions, a one-class helper is a private method; constructors take at most two objects, `d: <Class>Deps` (collaborators) and `p: <Class>Params` (configuration values and options), an error only `p`; every public method with inputs takes one `<Method><Interface>Request`, a method without inputs takes no parameter (no empty request object), and every public method returns one `<Method><Interface>Response`; implementations are named `<Tech><Interface>`, or `<Interface>Impl` only when nothing distinguishes them; framework-owned shapes (Nest controllers, guards, filters, hooks, modules; React components; `main.ts`) are exempt (user)
- Own error classes extending `DomainError`, handled by class or code, never by message; codes are the closed list `ERROR_CODES` in `packages/kernel` (a code outside it does not compile) and contracts build `ErrorCode` from it (user)
- No duplicated logic across apps or packages: framework-free shared logic (graceful shutdown on termination signals, the top-level fatal-error handler) lives in `packages/kernel`; shared NestJS-bound pieces (bootstrap, base config parsing of `NODE_ENV`/`LOG_LEVEL`/`REDIS_URL`/port, logging with redaction, the Redis connection module, the health module) live in a new `packages/service-kit` with the same layers and rules; each app adds its own parts through params (e.g. extra shutdown steps) (user)
- The change verifier also reports duplicated logic as a gap (user)
- Tests: one test file per source file, next to it; no tests of language facts or of test doubles; tests use Vitest tools (`vi.useFakeTimers`, `vi.fn`, object literals typed as the interface), no shared fake package (user)
- job-ui: Tailwind + shadcn/ui, TanStack Query (polling), feature folders (user)
- Strict TypeScript, ESLint + Prettier, Vitest in every workspace, pino structured logging, Conventional Commits (user)
- Health: `GET /health` on job-service only answers HTTP 200 with `{ "status": "ok" }`: no database or Redis probes, no instance list, no 503. A health check reports only that its own process is up and never checks related services, so services that wait for each other's health (compose `depends_on`, readiness checks) cannot form a circular dependency where none becomes healthy (user; replaces the earlier dependency and heartbeat health)
- Development: `npm run dev` starts Postgres and Redis in Docker and the apps on the host with hot reload; `docker compose up` runs the full stack (user)
- External cancel only from pending or scheduled; any other status gets a typed error (user; behaviour built in `job-cancel`)
- Retry is the external update failed → pending, not a separate endpoint (user; behaviour built in `job-retry`)
- The internal update method lives under an `/internal` prefix, is hidden from public Swagger and requires a service token from an env var (user)
- The service-token guard for `/internal` routes stays, but there is no ping route: services do not ping each other. Until `email-job-flow` adds the first internal route, the guard is tested through a test-only route (user)
- job-execution-service only starts, connects to Redis, logs that it has started, answers its own `GET /health` with HTTP 200 `{ "status": "ok" }`, and shuts down cleanly: no heartbeats, no readiness retry loop, no calls to job-service (user; replaces the earlier readiness loop and heartbeats)
- Two services: job-service (only service with Postgres access) and job-execution-service (no database access; reads and changes job state only through job-service). A separate service writing the jobs table directly is the shared-database anti-pattern and is ruled out (user)
- job-service has two update methods: an external one for clients, which may change only the status: to cancelled (from pending or scheduled only) or to pending (retry, from failed only), and a separate internal one used by job-execution-service for status, attempts, errors, progress, results and logs. Ideally this would be field-level internal attributes (as in gRPC); a separate method keeps it simple. Record the trade-off in DECISIONS.md (user)
- job-ui skeleton: shows only basic info that the UI has started; it does not call the backend or show any backend status, and has no loading text (user; replaces the earlier "text showing whether the backend is reachable")
- Test levels: unit; integration (one adapter with its real dependency, Testcontainers); per-app e2e (each app as a black box over its real interface with its own infrastructure, other apps simulated: job-service with its own Postgres and Redis, job-execution-service with its own Redis, job-ui with no backend calls); contracts through the shared Zod schemas (stubs and fixtures validated against `packages/contracts`, no Pact); system e2e on the full compose stack (user)
- E2E tool: Playwright for job-ui per-app e2e and for system e2e; backend per-app e2e with Vitest (user)
- Locations: per-app e2e in `apps/<app>/test/e2e`; system e2e in its own workspace `tests/system-e2e` (user)
- Scripts: `npm test` runs unit, integration and backend per-app e2e (Stop hook); `npm run test:e2e` runs job-ui Playwright and system e2e on compose (CI and the change verifier, not the Stop hook) (user)
- System e2e calls everything that exists: `GET /health`, the docs route, job-ui in a browser (shows it has started), and checks that scaled job-execution-service instances start and log it (user; the ping and instance-list checks are dropped with them)
- Framework errors (unknown route, request validation) use the same body `{code, message, details}` as our own errors, with new codes `ROUTE_NOT_FOUND` and `VALIDATION_FAILED` (validation issues in `details`); built in group 6 (user)
- No error response bypasses the uniform body: a body that is not valid JSON is invalid input → 400 `VALIDATION_FAILED`; a body over the configured size limit → 413 with a new code `PAYLOAD_TOO_LARGE` and the limit in `details`; every other framework error is mapped to the uniform body as well (user)
- An unexpected error returns 500 `INTERNAL_ERROR` with a generic message and empty `details`; the stack is logged, never returned (user confirmed)
- Shared test harnesses (start a built app on a free port, wait until it answers, stop it, count Redis connections) live once in a test-only workspace `tests/support` (`@job-queue/test-support`), imported only by tests; they are harnesses and container helpers, not fakes, and follow the same class rules (user)
- The integration test level has real tests: job-service's Prisma database adapter against Postgres and the shared Redis connection against Redis, with Testcontainers (user)
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
