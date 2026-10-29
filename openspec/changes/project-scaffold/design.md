# Design

## Context

Greenfield repository: only planning documents, the OpenSpec setup and `.claude/` hooks exist. See
proposal.md for motivation and decisions.md for every user decision. Specs: `system-health`,
`internal-api-access`. The flow's Stop hook runs `npm run typecheck`, `npm run lint`, `npm test`
from the root, and they must pass from the first commit.

## Goals / Non-Goals

**Goals:**
- A layout and set of conventions that every later change follows without restructuring.
- Each convention from CLAUDE.md present in code at least once (onion layers, DI tokens, error codes,
  injected clock, pino, boundary lint rule), so later changes copy a working example.

**Non-Goals:**
- No job tables, no queue usage, no job handlers (from `email-job-flow` on).
- No queue statistics in health (`queue-health`).
- No UI beyond the reachability text; shadcn/ui is initialised but no components are added yet.

## Decisions

### Repository layout

```
apps/
  job-service/               NestJS; only app with Postgres access
    prisma/                  schema.prisma + migrations (Prisma lives with its only owner)
    src/
      main.ts                composition root
      health/                module: domain/ application/ infrastructure/ presentation/
      internal-access/       module: service-token guard, /internal/v1/ping
      shared/                app-wide adapters (pino logger, error filter, config)
  job-execution-service/     NestJS application context (no public HTTP server)
    src/
      main.ts
      instance/              module: instance id, readiness loop, heartbeat
      job-service-client/    module: adapter for the Job-context port, calls /internal over HTTP
  job-ui/                    React + Vite; src/features/system-status/
packages/
  contracts/                 Zod schemas + inferred types: health response, error codes, error body
  kernel/                    framework-free ports and base types: Clock, Random, DomainError
tooling/                     shared tsconfig, eslint and vitest presets
```
- Alternative: `packages/db` shared Prisma package. Rejected: only job-service may touch the
  database (decisions.md), so the schema lives inside it.
- Alternative: job-execution-service with its own HTTP server for health. Rejected: liveness comes
  from heartbeats (decided); no port to expose.

### Onion layers and DI

Each module has `domain/` (pure TS, imports only `packages/kernel`), `application/` (use cases,
port interfaces), `infrastructure/` (adapters: Prisma, ioredis, fetch), `presentation/` (controllers,
mapping to `packages/contracts`). Ports are interfaces plus a `Symbol` token exported from the
module's `index.ts`; Nest binds `{ provide: TOKEN, useClass: Adapter }`.
Boundary enforcement: `eslint-plugin-boundaries` (layer rules: domain → kernel only; application →
domain; infrastructure/presentation → application, domain) plus `no-restricted-imports` against
deep imports into another module (only `<module>/index.ts`). Alternative: dependency-cruiser in CI;
rejected to keep a single lint step that the per-edit lint hook already runs.

### Health

- `DependencyProbe` port (name, `check(): Promise<'up' | 'down'>`) with a Prisma adapter (`SELECT 1`)
  and a Redis adapter (`PING`), each with the configured probe timeout.
- `GetSystemHealth` use case aggregates probes and the live-instance list; overall `ok` only if all
  probes are `up`. The controller maps `ok` → 200, `unavailable` → 503. Response schema
  `HealthResponse` in `packages/contracts`.
- We write this rather than use `@nestjs/terminus`: the response shape is ours (contracts, later
  extended by `queue-health`), and the aggregation is a pure function that is easy to unit test.

### Instance heartbeats

- Each execution instance gets an id at startup (hostname + random suffix, through the `Random` port).
- Heartbeats go to a Redis sorted set `execution:instances` (member = instance id, score = last
  heartbeat time from the `Clock` port), refreshed every configured interval. job-service reads
  members with a score newer than now minus the configured expiry, and removes older ones.
- On graceful shutdown the instance removes its member; if it crashes, it ages out by expiry.
- Alternative: one key per instance with TTL + `SCAN`. Rejected: `SCAN` is O(keyspace), and expiry
  decided by the server clock is harder to test than a score compared against an injected clock.

### Readiness loop (execution)

`ReadinessLoop` retries the Redis ping and the job-service reachability check (`GET /internal/v1/ping`
with the token) with exponential backoff from the configured initial delay to the configured cap,
logging each failure. Heartbeats start only after both succeed. Delays go through an injected
`Sleeper` so tests run instantly.

### Internal access

- `ServiceTokenGuard` on every controller under `/internal/v1`: compares the `Authorization: Bearer`
  token with the configured one using `crypto.timingSafeEqual`; failure throws
  `UnauthorizedInternalAccessError` (code `INTERNAL_UNAUTHORIZED`), mapped to 401 by the error filter.
- Internal controllers carry `@ApiExcludeController()`, so Swagger omits them.
- Alternative: mTLS or gRPC with service identity. Not now (decided); noted in DECISIONS.md.

### Errors

`DomainError` base in `packages/kernel` (`code`, `message`, `details`). Codes are a union in
`packages/contracts` (`ErrorCode`), so the UI can switch on them. One global exception filter per
app maps codes to HTTP status via a table and returns `{ code, message, details }`; unknown errors
become 500 `INTERNAL_ERROR` and are logged with the stack.

### Contracts and OpenAPI

Zod schemas in `packages/contracts`; Nest validates with `nestjs-zod`'s `ZodValidationPipe` and
generates Swagger from the same schemas (`createZodDto` + `@nestjs/swagger`, docs at `/docs`).
Alternative: `zod-openapi` hand-wired; rejected for more glue.

### Config

Each app validates `process.env` with a Zod schema at startup and fails with a clear message if
invalid. Initial values (in `.env.example`, tunable):
- heartbeat interval 5 s, heartbeat expiry 15 s
- readiness backoff 500 ms initial, ×2, cap 10 s
- health probe timeout 1 s
- job-ui health polling interval 5 s
- ports: job-service 3000, job-ui 8080 (compose) / 5173 (dev)

### Logging

`nestjs-pino` in both apps (JSON in containers, `pino-pretty` in dev). Execution logs carry
`instanceId` on every line via a child logger.

### job-ui

Vite + React + TypeScript, Tailwind v4, shadcn/ui initialised (`components.json`, `components/ui/`).
`features/system-status/` has `useHealth()` (TanStack Query, `refetchInterval` from config) and the
status text. Reachable = `GET /health` answered (any HTTP status); unreachable = network error. The
API base is `/api`: Vite's dev proxy and nginx in compose forward `/api/*` to job-service, so no CORS
setup is needed.

### Docker

- One root multi-stage `Dockerfile`: `deps` (npm ci with workspaces) → `build` → targets
  `job-service`, `job-execution-service`, `migrate` (Prisma CLI, `prisma migrate deploy`), `job-ui`
  (nginx serving `apps/job-ui/dist` with the `/api` proxy). Base `node:26-alpine`.
- `docker-compose.yml`: `postgres`, `redis` (healthchecks), `migrate` (one-shot), `job-service`
  (depends on `migrate` completed successfully, healthcheck on `/health`), `job-execution-service`
  (scalable, no ports, no `DATABASE_URL`), `job-ui`.
- Dev: `npm run dev` = `docker compose up -d postgres redis` then the three apps in watch mode
  (`concurrently`), Prisma migrate dev against the container.

### Testing

Levels (decided), file suffixes and where each runs:

| Level | Suffix / location | Runner | Runs in |
|---|---|---|---|
| Unit | `*.test.ts` next to code | Vitest | `npm test` |
| Integration | `*.int.test.ts` | Vitest + Testcontainers | `npm test` |
| Per-app e2e, backends | `apps/<app>/test/e2e/*.e2e.test.ts` | Vitest + Testcontainers | `npm test` |
| Per-app e2e, job-ui | `apps/job-ui/test/e2e/*.spec.ts` | Playwright | `npm run test:e2e` |
| System e2e | `tests/system-e2e/*.spec.ts` | Playwright | `npm run test:e2e` |

- Vitest per workspace via a root `vitest.workspace`; Nest apps use `unplugin-swc` for decorator
  metadata. Unit, integration and e2e are separate Vitest projects so they can be run alone.
- Unit: health aggregation, heartbeat liveness filtering, readiness backoff, token guard, error
  filter, with fake Clock/Random/Sleeper. job-ui components: Vitest + Testing Library + MSW.
- Integration: one adapter against its real dependency (Prisma probe vs Postgres, Redis heartbeat
  adapters vs Redis, HTTP client vs a local server).
- Per-app e2e, job-service: the full Nest app over real HTTP with Testcontainers Postgres and Redis;
  execution instances simulated by writing heartbeats into `execution:instances`.
- Per-app e2e, job-execution-service: the real process (spawned) with Testcontainers Redis; job-service
  simulated by a stub HTTP server whose responses are parsed by `packages/contracts` schemas.
- Per-app e2e, job-ui: Playwright against `vite preview` of the built app; every `/api` request
  intercepted (`page.route`) and answered with fixtures validated by `packages/contracts`.
- Contracts: no Pact. Stubs and fixtures must pass the shared Zod schemas, so a contract change
  breaks the stubs at compile or test time. Recorded in DECISIONS.md.
- System e2e (`tests/system-e2e` workspace): Playwright `globalSetup` runs
  `docker compose -p scaffold-e2e up -d --build --wait --scale job-execution-service=2` with a
  dedicated env file and ports, `globalTeardown` runs `down -v`. It calls `GET /health` (validated
  against `HealthResponse`), the docs route, `/internal/v1/ping` without, with a wrong and with the
  right token, opens job-ui through nginx, checks two instances are listed, stops one with
  `docker compose stop` and waits until it disappears from health.
- Tests are named after the spec scenarios.

### CI

`.github/workflows/checks.yml`: push to `master` and PRs; Node 26; language check, `npm ci`,
typecheck, lint, test (Testcontainers works on `ubuntu-latest` with Docker), build,
`docker compose build`, then a separate job that installs Playwright browsers and runs
`npm run test:e2e`, uploading the Playwright report on failure.

### Documentation updates in this change

- CLAUDE.md Architecture and Commands: the two-service model, execution reaching job state only
  through `/internal`, `packages/kernel`, `tooling/`, real script names.
- DECISIONS.md: the job-state ownership trade-off (separate internal update method instead of
  field-level internal attributes; service token instead of mTLS/gRPC identity).

## Risks / Trade-offs

- [Node 26 support in Prisma, NestJS, SWC or Vite lags] → the first task verifies installs and builds
  on Node 26; fall back to 24 (decided) if a core library fails.
- [Testcontainers slow or unavailable locally] → integration tests live in `*.int.test.ts` with their
  own Vitest project, so unit tests still run fast; the Stop hook runs both.
- [Boundary lint rules too strict for Nest wiring in `main.ts`] → the composition root (`main.ts`,
  `*.module.ts`) is exempt from layer rules.
- [Extra hop: execution → job-service HTTP for every state change later] → accepted by decision;
  timeouts and retries are designed in `email-job-flow`.
- [Shared service token leaks] → token only in env, never logged (pino redaction of the
  `authorization` header).
