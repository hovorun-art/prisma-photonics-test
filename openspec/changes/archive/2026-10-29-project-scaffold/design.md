# Design

## Context

Greenfield repository: only planning documents, the OpenSpec setup and `.claude/` hooks exist. See
proposal.md for motivation and decisions.md for every user decision. Specs: `system-health`,
`internal-api-access`, `api-errors`. The flow's Stop hook runs `npm run typecheck`, `npm run lint`, `npm test`
from the root, and they must pass from the first commit.

## Goals / Non-Goals

**Goals:**
- A layout and set of conventions that every later change follows without restructuring.
- Each convention from CLAUDE.md present in code at least once (onion layers, DI tokens, error codes,
  injected clock, pino, boundary lint rule), so later changes copy a working example.

**Non-Goals:**
- No job tables, no queue usage, no job handlers (from `email-job-flow` on).
- No queue statistics in health (`queue-health`).
- No UI beyond the started page; shadcn/ui is initialised but no components are added yet.

## Decisions

### Repository layout

Layers first (decided): each app's `src/` has `domain/`, `infra/` and `app/`, features are subfolders
inside each layer.
```
apps/
  job-service/               NestJS; only app with Postgres access
    prisma/                  schema.prisma + migrations (Prisma lives with its only owner)
    src/
      main.ts                starts through JobServiceBootstrap
      domain/                config/, database/ (Database + token), http/ (MalformedBodyError,
                             PayloadTooLargeError), internal-access/ (InternalAccess,
                             UnauthorizedInternalAccessError)
      infra/                 bootstrap/ (JobServiceBootstrap), config/, docs/ (Swagger setup step),
                             http/ (request-body setup step), internal-access/, prisma/ (PrismaDatabase)
      app/                   app.module.ts; errors/ (error filter), internal-access/ (guard, module),
                             prisma/ (module)
  job-execution-service/     NestJS app with one route, GET /health (port not published, so it scales)
    src/
      main.ts
      domain/                config/ (ExecutionConfig), instance/ (instance id and its factory)
      infra/                 config/ (Zod parser), instance/ (hostname instance id factory)
      app/                   app.module.ts (health, Redis, logging and config come from service-kit)
  job-ui/                    React + Vite; src/features/app-shell/
packages/
  contracts/                 Zod schemas + inferred types: health response, error body, internal
                             prefix, SERVICE_TOKEN_SCHEME
  kernel/                    src/domain (Clock, Random, Sleeper, Closable, GracefulShutdown,
                             FatalErrorHandler ports, DomainError, ERROR_CODES), src/infra (SystemClock,
                             UniformRandom/SystemRandom, AbortableSleeper/SystemSleeper,
                             SignalGracefulShutdown, ProcessFatalErrorHandler)
  service-kit/               shared NestJS-bound pieces for the backends (see "Shared code"):
                             domain/ bootstrap, config, logging, redis; infra/ the same; app/ config,
                             health, logging and redis modules
tests/
  support/                   test-only helpers (see "Test support")
  system-e2e/                Playwright against the full compose stack
tooling/                     shared tsconfig, eslint and vitest presets
```
- Alternative: `packages/db` shared Prisma package. Rejected: only job-service may touch the
  database (decisions.md), so the schema lives inside it.
- job-execution-service gets a small HTTP server only for `GET /health` (decided). Its port is not
  published in compose, so instances can scale; the compose healthcheck calls it from inside the
  container.

### Layers, class rules and DI

- `domain/` holds only interfaces (ports and use cases) with their `<Method><Interface>Request` /
  `Response` types and `Symbol` token, value types and domain errors. `infra/` implements them;
  `app/` holds Nest entry points and the wiring.
- Every class implements an interface; constructors take `d: <Class>Deps` (collaborators) and,
  when configured, `p: <Class>Params` (values and options); every public method takes and returns
  one object. Modules bind implementations with `useFactory` + `inject`, building the
  deps object: `{ provide: INTERNAL_ACCESS, useFactory: (config) => new
  ServiceTokenInternalAccess({ serviceToken: config.internalServiceToken }), inject: [JOB_SERVICE_CONFIG] }`.
- Enforced by ESLint (`tooling/eslint/config.mjs`): `eslint-plugin-boundaries` for the layers
  (domain → domain, kernel, contracts; infra → domain, infra; app → domain; only `*.module.ts` and
  `main.ts` may import `infra/`; never across apps) and `no-restricted-syntax` for the class rules
  (no top-level functions outside `.tsx`, `main.ts` and configs; every class implements or extends;
  at most one parameter per method and interface method, except in `app/`).
- Alternative: dependency-cruiser in CI; rejected to keep a single lint step that the per-edit lint
  hook already runs.

### Health

- Both backends answer `GET /health` with HTTP 200 and `{ "status": "ok" }` (`HealthResponse` in
  `packages/contracts`): a controller in `app/health/`, no probes and no dependencies (decided). It
  answers while the process runs; whether Postgres or Redis are up is not part of it.
- job-service publishes it in its Swagger docs; job-execution-service has no docs.
- We write this rather than use `@nestjs/terminus`: a constant answer needs no health framework.

### Execution instance startup

- job-execution-service connects to Redis at startup (ioredis), then logs that it has started
  (pino, with a generated instance id on every log line), and closes the connection on shutdown.
- It does no work yet: no heartbeats, no readiness loop, no calls to job-service (decided).

### Internal access

- No internal route exists in this change (no ping, decided); `email-job-flow` adds the first one.
  The guard and its e2e scenarios are exercised through a test-only controller under `/internal/v1`
  that only the tests register.
- `ServiceTokenGuard` on every controller under `/internal/v1`: compares the `Authorization: Bearer`
  token (`SERVICE_TOKEN_SCHEME`) with the one from job-service's validated config (the only place the
  token is read) using `crypto.timingSafeEqual`; failure throws
  `UnauthorizedInternalAccessError` (code `INTERNAL_UNAUTHORIZED`), mapped to 401 by the error filter.
- Internal controllers carry `@ApiExcludeController()`, so Swagger omits them.
- Alternative: mTLS or gRPC with service identity. Not now (decided); noted in DECISIONS.md.

### Errors

`DomainError` base in `packages/kernel` (`code`, `message`, `details`, constructed from one params
object, `DomainErrorParams`). Codes are the closed list `ERROR_CODES` in the kernel; `DomainError<TCode extends
ErrorCode>` rejects any other code at compile time, and contracts build the Zod `ErrorCode` from the
same list, so the UI can switch on them. One global exception filter in job-service maps codes to
HTTP status via a table and returns `{ code, message, details }`. Framework errors are mapped too:
Nest's `NotFoundException` for an unknown route → 404 `ROUTE_NOT_FOUND`; a `nestjs-zod` validation
error → 400 `VALIDATION_FAILED` with the Zod issues (`path`, `message`) in `details`; the body
parser's invalid-JSON error → 400 `VALIDATION_FAILED`; its too-large error → 413
`PAYLOAD_TOO_LARGE` with the configured limit (Nest/Express default 100 kB, set explicitly) in
`details`. No other framework error passes through with Nest's body: anything not mapped is treated
as unexpected. Unknown errors
become 500 `INTERNAL_ERROR`, logged with the stack, with empty `details`. The `VALIDATION_FAILED`
scenario is tested through a test-only route with a Zod body, since the scaffold has no validated
endpoint yet.

### Contracts and OpenAPI

Zod schemas in `packages/contracts`; Nest validates with `nestjs-zod`'s `ZodValidationPipe` and
generates Swagger from the same schemas (`createZodDto` + `@nestjs/swagger`, docs at `/docs`).
Alternative: `zod-openapi` hand-wired; rejected for more glue.

### Config

Each app validates `process.env` with a Zod schema at startup and fails with a clear message if
invalid. Initial values (in `.env.example`, tunable):
- ports: job-service 3000, job-execution-service 3001 (container only), job-ui 8080 (compose) /
  5173 (dev)

### Shared code

No logic is written twice (decided); the verifier checks it.
- `packages/kernel` (framework-free): `GracefulShutdown` interface in `domain/`, implemented by
  `SignalGracefulShutdown` in `infra/`: deps `{ app: Closable, process, log }`, params
  `{ signals, steps }`. On the first termination signal it logs, runs the params' extra
  `ShutdownStep`s in order, closes the app, and sets exit code 0 (1 if anything failed); later
  signals change nothing. Also `FatalErrorHandler` (`ProcessFatalErrorHandler`): prints the stack to
  stderr and sets exit code 1, used by each `main.ts` for bootstrap failures.
- `packages/service-kit` (NestJS, pino, ioredis, Zod; same `domain/`/`infra/`/`app/` layers and
  class rules), used by both backends:
  - base config: the shared env fields (`NODE_ENV`, `LOG_LEVEL`, `REDIS_URL` and the port, whose
    variable name each app passes as a param) and the closed
    `NODE_ENVS` / `LOG_LEVELS` lists in one Zod schema that each app extends with its own fields;
  - logging: one `LoggingModule` (pino JSON, `pino-pretty` in development, credential redaction),
    params for app-specific base fields such as `instanceId`;
  - Redis: a `RedisConnection` interface in `domain/` implemented by `IoRedisConnection` in
    `infra/` (connection options, error listener, first answer, `quit()`); `RedisModule` in `app/`
    only wires it,
    params for the connection name and whether startup waits for a first answer;
  - health: one `HealthModule` / controller for `GET /health` → 200 `{ "status": "ok" }`, with
    Swagger metadata (harmless where no docs are published);
  - bootstrap: `NestServiceBootstrap` (parse config or exit with the problems, create the Nest app
    with buffered pino logs, install `SignalGracefulShutdown`, listen, log the start), params for the
    service name, the app module factory and extra setup steps (job-service adds Swagger and the
    error filter).
- Apps keep only what is theirs: job-service its Prisma module, internal access, error filter and
  docs; job-execution-service its instance id.

### Test support

Harnesses used by more than one app's tests live once in the test-only workspace `tests/support`
(`@job-queue/test-support`): a spawned-process harness (build, start on a free port, wait until
`/health` answers, stop with a signal, capture logs) and container helpers (Redis connection count
by client name, Postgres connection count by application name) and `CONTAINER_IMAGES`, the
Postgres and Redis images the tests start (the same as in `docker-compose.yml`), used by
integration and e2e tests. Same class rules; imported only by test files.

### Prisma client

job-service's database client is behind a `Database` interface in `domain/` (with its token),
implemented by `PrismaDatabase`; an integration test connects it to a Postgres container and runs a
query.



The generated Prisma client is not committed: it is generated into a gitignored folder by
`prisma generate`, run by `postinstall` and before `typecheck`, `test` and `build` in job-service, so
a fresh `npm ci` works.

### Logging

`nestjs-pino` in both apps (JSON in containers, `pino-pretty` in dev). Execution logs carry
`instanceId` on every line.

### job-ui

Vite + React + TypeScript, Tailwind v4, shadcn/ui initialised (`components.json`, `components/ui/`).
The page shows the application name and a started message from `locales/en` (feature folder
`features/app-shell/`). No backend calls in this change: TanStack Query and the `/api` proxy (Vite
dev proxy, nginx in compose) are set up for later changes but unused.

### Docker

- One root multi-stage `Dockerfile`: `deps` (npm ci with workspaces) → `build` → targets
  `job-service`, `job-execution-service`, `migrate` (Prisma CLI, `prisma migrate deploy`), `job-ui`
  (nginx serving `apps/job-ui/dist` with the `/api` proxy). Base `node:26-alpine`.
- `docker-compose.yml`: `postgres`, `redis` (healthchecks), `migrate` (one-shot), `job-service`
  (depends on `migrate` completed successfully, healthcheck on `/health`), `job-execution-service`
  (scalable, port not published, healthcheck on its `/health`, no `DATABASE_URL`), `job-ui`.
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

- Vitest per workspace through `test.projects` in the root `vitest.config.ts` (Vitest 4 dropped
  workspace files); Nest apps use `unplugin-swc` for decorator metadata. Unit, integration and e2e
  are separate Vitest projects so they can be run alone.
- Unit: token check, error filter, config parsing, instance startup. Time and sleeping through `vi.useFakeTimers()` with the real `SystemClock` /
  `SystemSleeper`; other ports as `vi.fn()` or object literals typed as the interface. No shared
  fake package and no tests for test doubles. job-ui components: Vitest + Testing Library.
- Integration: one adapter against its real dependency (Prisma connection vs Postgres, Redis
  connection vs Redis).
- Per-app e2e, job-service: the full Nest app over real HTTP with Testcontainers Postgres and Redis;
  internal access through a test-only `/internal/v1` controller.
- Per-app e2e, job-execution-service: the real process (spawned) with Testcontainers Redis and no
  database settings: health answers, the started log line appears, a termination signal exits 0.
- Per-app e2e, job-ui: Playwright against `vite preview` of the built app; any `/api` request fails
  the test (none is expected).
- Contracts: no Pact. Stubs and fixtures must pass the shared Zod schemas, so a contract change
  breaks the stubs at compile or test time. Recorded in DECISIONS.md.
- System e2e (`tests/system-e2e` workspace): Playwright `globalSetup` runs
  `docker compose -p scaffold-e2e up -d --build --wait --scale job-execution-service=2` with a
  dedicated env file and ports, `globalTeardown` runs `down -v`. It calls job-service's `GET /health`
  (validated against `HealthResponse`) and the docs route, checks each job-execution-service
  instance is healthy and logged that it started (`docker compose ps` health and `logs`), and opens
  job-ui through nginx and sees the started message.
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
  field-level internal attributes; service token instead of mTLS/gRPC identity), contract testing
  through shared Zod instead of Pact, and the code-structure rules (layers first, interface per
  class, deps object, Request/Response objects) with their cost in boilerplate.

## Risks / Trade-offs

- [Node 26 support in Prisma, NestJS, SWC or Vite lags] → the first task verifies installs and builds
  on Node 26; fall back to 24 (decided) if a core library fails.
- [Testcontainers slow or unavailable locally] → integration tests live in `*.int.test.ts` with their
  own Vitest project, so unit tests still run fast; the Stop hook runs both.
- [Boundary lint rules too strict for Nest wiring] → `main.ts` and `*.module.ts` may import `infra/`;
  `app/` keeps Nest's own signatures (per-parameter injection, `catch(exception, host)`).
- [Class rules add boilerplate (Request/Response types, deps objects, interfaces for single
  implementations)] → accepted by decision for uniform, extractable code; noted in DECISIONS.md.
- [Extra hop: execution → job-service HTTP for every state change later] → accepted by decision;
  timeouts and retries are designed in `email-job-flow`.
- [Shared service token leaks] → token only in env, never logged (pino redaction of the
  `authorization` header).
