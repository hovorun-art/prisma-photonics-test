# Tasks

## Plan

```
1 Foundation ──┬── 2 job-service: health ─────┐
               ├── 3 job-service: internal ───┼── 6 Code structure refactor ── 7 Docker, CI ── 8 Shared code ── 9 Docs ── 10 Verifier fixes (integration)
               ├── 4 job-execution-service ───┤
               └── 5 job-ui ──────────────────┘
```
Groups 2, 3, 4 and 5 could run in parallel after 1. Group 4 calls `/internal/v1/ping` through the
contract defined in group 1, so it does not need group 3's code. Group 6 applies the code-structure
rules decided after groups 1–5 to all their code and runs alone; it replaces the paths those groups
list under "Owns". Groups 7, 8, 9 and 10 run one after another; group 10 (fixes from the verifier) runs last.

## 1. Foundation: workspaces, tooling, shared packages

Owns: `package.json`, `package-lock.json`, `tooling/**`, `vitest.workspace.ts`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.env.example`, `packages/kernel/**`, `packages/contracts/**`, `apps/*/package.json`, `apps/*/tsconfig*.json`, `apps/*/vitest.config.ts`, `tests/system-e2e/package.json`, `tests/system-e2e/tsconfig.json` · Depends on: none · Parallel with: none

- [x] 1.1 Create the root `package.json` (npm workspaces `apps/*`, `packages/*`, `tests/*`; `engines.node` 26; scripts `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `format`) and the workspace `package.json` files; verify `npm install` succeeds on Node 26, falling back to 24 if a core library (Prisma, NestJS, SWC, Vite) fails, and record which was used
- [x] 1.2 Add `tooling/` presets (strict tsconfig with `noUncheckedIndexedAccess`, ESLint flat config with typescript-eslint, `eslint-plugin-boundaries` layer rules (rewritten in 6.2), composition-root exemption, Prettier) and verify `npm run lint` and `npm run typecheck` pass on an empty tree
- [x] 1.3 Set up Vitest across workspaces (`test.projects` in the root `vitest.config.ts`, `unplugin-swc` for the Nest apps, separate Vitest projects for unit `*.test.ts`, integration `*.int.test.ts` and backend per-app e2e `test/e2e/*.e2e.test.ts`; `npm test` runs all three, `test:e2e` runs the Playwright suites) and verify `npm test` runs and passes with no tests
- [x] 1.4 Write failing tests for `packages/kernel`: `DomainError` carries `code`, `message` and `details` and accepts only codes from `ERROR_CODES`; the system `Clock`, `Random` and `Sleeper` behave as specified
- [x] 1.5 Implement `packages/kernel` (`ERROR_CODES`, `DomainError`, `Clock`, `Random`, `Sleeper` ports and system implementations) and verify 1.4 passes
- [x] 1.6 Write failing tests for `packages/contracts`: `HealthResponse` schema accepts ok/unavailable shapes with dependency statuses and instance list; `ErrorBody` schema; `ErrorCode` includes `INTERNAL_UNAUTHORIZED` and `INTERNAL_ERROR`; internal ping response schema
- [x] 1.7 Implement `packages/contracts` (Zod schemas plus inferred types) and verify 1.6 passes
- [x] 1.8 Write `.env.example` with every variable and the initial values from design.md (ports, URLs, service token placeholder, heartbeat interval and expiry, backoff, probe timeout, polling interval) and update `.gitignore` (`.env`, `dist`, `coverage`); verify `npm run lint` and `npm run typecheck` still pass

## 2. job-service: health, errors, logging, API docs

Owns: `apps/job-service/src/main.ts`, `apps/job-service/src/app.module.ts`, `apps/job-service/src/shared/**`, `apps/job-service/src/health/**`, `apps/job-service/prisma/**`, `apps/job-service/src/**/*.int.test.ts` for its own adapters, `apps/job-service/test/e2e/health*`, `apps/job-service/test/e2e/docs*`, `apps/job-service/test/e2e/support/**` · Depends on: 1 · Parallel with: 3, 4, 5

- [x] 2.1 Write failing unit tests for the health aggregation, named after the scenarios "All dependencies reachable", "Database unreachable", "Queue store unreachable" and "No instances running"
- [x] 2.2 Implement the `health` module's domain and application layers (`DependencyProbe` port, live-instance query port, `GetSystemHealth`) and verify 2.1 passes
- [x] 2.3 Write failing unit tests for live-instance filtering by heartbeat age with a fake clock, for "Running instances are listed" and "Stopped instance disappears"
- [x] 2.4 Implement the Redis sorted-set adapter that reads and prunes `execution:instances` and verify 2.3 passes
- [x] 2.5 Set up Prisma in `apps/job-service/prisma` (datasource only, empty initial migration) and the Prisma and Redis probe adapters with the configured timeout; verify `prisma validate` and the typecheck pass
- [x] 2.6 Write failing tests for the global error filter (a `DomainError` maps to its status and body `{code, message, details}`; an unknown error gives 500 `INTERNAL_ERROR` and is logged)
- [x] 2.7 Implement config validation (Zod over env), `nestjs-pino` logging with `authorization` redaction, the error filter, `GET /health` (200/503), Swagger at `/docs` from the Zod schemas, and graceful shutdown hooks; verify 2.6 passes
- [x] 2.8 Write integration tests for the Prisma probe (Postgres container) and the Redis probe and instance adapter (Redis container), and verify they pass
- [x] 2.9 Write per-app e2e tests (the full app over HTTP, Testcontainers Postgres and Redis, execution instances simulated by writing heartbeats, responses parsed with `HealthResponse`) for "All dependencies reachable", "Database unreachable", "Queue store unreachable", "Running instances are listed", "Stopped instance disappears", "Docs available" and "job-service stopped", and verify they pass

## 3. job-service: internal access

Owns: `apps/job-service/src/internal-access/**`, `apps/job-service/test/e2e/internal*` · Depends on: 1 · Parallel with: 2, 4, 5

- [x] 3.1 Write failing unit tests for `ServiceTokenGuard` named "Missing token", "Wrong token" and "Valid token" (constant-time comparison, `UnauthorizedInternalAccessError` with code `INTERNAL_UNAUTHORIZED`)
- [x] 3.2 Implement the guard and `GET /internal/v1/ping` (excluded from Swagger) as an exportable `InternalAccessModule`, and verify 3.1 passes
- [x] 3.3 Write per-app e2e tests over HTTP for "Missing token", "Wrong token", "Valid token" and "Docs exclude internal routes"; verify they pass against a test module that imports `InternalAccessModule` (group 6 re-runs them against the real app)

## 4. job-execution-service: readiness, heartbeat, shutdown

Owns: `apps/job-execution-service/src/**`, `apps/job-execution-service/test/**` · Depends on: 1 · Parallel with: 2, 3, 5

- [x] 4.1 Write failing unit tests with a fake `Sleeper`, `Clock` and probes for "Dependency unavailable at startup", "Dependency becomes available" and "Misconfigured token" (backoff grows to the configured cap, each failure logged, no heartbeat before both dependencies are ready)
- [x] 4.2 Implement the `instance` module (instance id via `Random`, `ReadinessLoop`, `Heartbeat` port and Redis sorted-set adapter) and the `job-service-client` module (port plus HTTP adapter calling `/internal/v1/ping` with the bearer token and a timeout); verify 4.1 passes
- [x] 4.3 Write failing tests for "Execution instance stopped": on a termination signal the heartbeat stops, the member is removed and the process exits 0
- [x] 4.4 Implement `main.ts` (Nest application context, config validation, pino with `instanceId`, shutdown hooks; no `DATABASE_URL` in its config schema) and verify 4.3 passes
- [x] 4.5 Write integration tests for the Redis heartbeat adapter (Redis container) and the job-service HTTP client (local stub server), and verify they pass
- [x] 4.6 Write per-app e2e tests (the real process spawned, Testcontainers Redis, job-service simulated by a stub server whose responses pass `packages/contracts`) for "Reachability check with token", "Misconfigured token", "Dependency becomes available" and "Execution instance stopped", and verify they pass

## 5. job-ui: started page

Owns: `apps/job-ui/**` except `package.json`, `tsconfig*.json`, `vitest.config.ts` (group 1) and `nginx.conf` (group 6) · Depends on: 1 · Parallel with: 2, 3, 4

- [x] 5.1 Scaffold Vite + React + TypeScript with Tailwind v4 and shadcn/ui initialised (`components.json`, `src/components/ui/`), TanStack Query provider, and a Vite dev proxy from `/api` to job-service; verify `npm run build -w apps/job-ui` succeeds
- [x] 5.2 Write failing tests (Vitest, Testing Library) named "UI started" and "Backend not needed"
- [x] 5.3 Implement `features/app-shell` (application name and started message from `locales/en`; no backend calls; remove the earlier health polling, its config and fixtures) and verify 5.2 passes
- [x] 5.4 Write per-app e2e tests with Playwright against `vite preview` for "UI started" and "Backend not needed" (any `/api` request fails the test); verify they pass with `npm run test:e2e -w apps/job-ui`

## 6. Code structure refactor and simplification

Owns: `packages/kernel/**`, `packages/contracts/**`, `tooling/eslint/**`, `tooling/vitest/**`, `apps/job-service/src/**`, `apps/job-service/test/**`, `apps/job-service/package.json`, `apps/job-execution-service/src/**`, `apps/job-execution-service/test/**`, `apps/job-execution-service/package.json`, `.gitignore`, `.env.example` · Depends on: 1, 2, 3, 4, 5 · Parallel with: none

- [x] 6.1 Refactor `packages/kernel` (`src/domain` + `src/infra`, Request/Response ports, no free functions, `DomainError` from a props object, no fakes package) and `packages/contracts` (`SERVICE_TOKEN_SCHEME` instead of a header function, `EXECUTION_INSTANCES_KEY`); verify their tests, lint and typecheck pass
- [x] 6.2 Rewrite the ESLint rules for layers first (`src/domain`, `src/infra`, `src/app`; only `*.module.ts` and `main.ts` import `infra/`; never across apps) and the class rules (no top-level functions outside `.tsx`, `main.ts` and configs; every class implements or extends; one parameter per method); verify with throwaway probe files that violations are reported
- [x] 6.3 Refactor `apps/job-execution-service` to the layers-first layout and class rules, tests on Vitest tools instead of fakes; verify its lint, typecheck and all its unit, integration and e2e tests pass with every scenario test still present
- [x] 6.4 Refactor `apps/job-service` to the layers-first layout and class rules, tests on Vitest tools instead of fakes; verify its lint, typecheck and all its unit, integration and e2e tests pass with every scenario test still present
- [x] 6.5 Read the service token only from job-service's validated config, register the internal-access module in the app wiring, and run the internal-access per-app e2e tests against the real app (with the real error filter mapping `INTERNAL_UNAUTHORIZED` to 401); verify they pass
- [x] 6.6 Stop committing the generated Prisma client: gitignore it and run `prisma generate` on `postinstall` and before `typecheck`, `test` and `build`; verify a fresh `npm ci` followed by `npm run typecheck` passes
- [x] 6.7 Rewrite the tests for the simplified behaviour and see them fail: "job-service running" and "job-execution-service running" (`GET /health` → 200 `{ "status": "ok" }`), "Instance started", "Starts without database settings", "job-execution-service stopped", "job-service stopped", and the internal-access scenarios through a test-only `/internal/v1` controller
- [x] 6.8 Remove the dependency probes, instance registry, heartbeat expiry, heartbeats, readiness loop, job-service client and the ping route; shrink `HealthResponse` to `{ status: 'ok' }` and drop `DependencyStatus`, `ExecutionInstance`, `EXECUTION_INSTANCES_KEY`, `InternalPingResponse` and `INTERNAL_PING_ROUTE` from contracts; drop the unused heartbeat, backoff, probe-timeout and job-service URL variables from `.env.example`; add job-execution-service's HTTP server with its `GET /health` on the configured port; verify 6.7 passes and the full checks pass
- [x] 6.9 Write failing tests for the `api-errors` scenarios "Known failure", "Unexpected failure", "Unknown route" and "Invalid request" (job-service per-app e2e; "Invalid request" through a test-only route with a Zod body)
- [x] 6.10 Add `ROUTE_NOT_FOUND` and `VALIDATION_FAILED` to `ERROR_CODES` and map the framework errors in the error filter; verify 6.9 passes

## 7. Docker, CI

Owns: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `apps/job-ui/nginx.conf`, `tests/system-e2e/**` except its `package.json` and `tsconfig.json`, `.github/workflows/checks.yml`, `.claude/flow.conf` · Depends on: 6 · Parallel with: none

- [x] 7.1 Write the multi-stage `Dockerfile` (targets `job-service`, `job-execution-service`, `migrate`, `job-ui` with nginx and the `/api` proxy) and `.dockerignore`; verify `docker compose build` succeeds
- [x] 7.2 Write `docker-compose.yml` (postgres and redis with healthchecks, one-shot `migrate`, job-service depending on it, scalable job-execution-service without DB access, job-ui) and the `npm run dev` flow; verify `docker compose up --scale job-execution-service=2` brings every service to healthy (both backends' `GET /health` answer 200 `{ "status": "ok" }`), each execution instance logs that it started, the job-ui page shows the started message, and `docker compose down` exits cleanly
- [x] 7.3 Write the system e2e suite in `tests/system-e2e` (Playwright; global setup starts the compose stack under its own project name with two execution instances, teardown removes it): job-service `GET /health` answers 200 and passes `HealthResponse`; docs route available and without `/internal`; both execution instances are healthy and logged that they started; job-ui through nginx shows the started message. Verify `npm run test:e2e` passes
- [x] 7.4 Update `.github/workflows/checks.yml` (branch `master`, Node 26, add `docker compose build`, and a job that installs Playwright browsers, runs `npm run test:e2e` and uploads the report on failure) and keep `.claude/flow.conf` `CHECK_CMDS` in sync with the real script names
## 8. Shared code and constructor params

Owns: `packages/kernel/**`, `packages/service-kit/**`, `apps/job-service/src/**`, `apps/job-service/test/**`, `apps/job-service/package.json`, `apps/job-execution-service/src/**`, `apps/job-execution-service/test/**`, `apps/job-execution-service/package.json`, root `package.json`, `package-lock.json`, `tooling/**`, `Dockerfile` · Depends on: 7 · Parallel with: none

- [x] 8.1 Write failing tests for the kernel's `SignalGracefulShutdown` (first signal logs, runs the params' extra steps in order, closes the app, exit code 0; a failing step or close gives exit code 1; a second signal changes nothing) and `ProcessFatalErrorHandler`; implement them in `packages/kernel` (`domain/` interfaces, `infra/` classes) and verify the tests pass
- [x] 8.2 Create `packages/service-kit` (workspace, tsconfig, Vitest projects, lint, build) and move into it, test first, the shared base config schema with `NODE_ENVS` / `LOG_LEVELS`, the logging module with redaction, the Redis module, the health module and `NestServiceBootstrap`; verify its tests pass
- [x] 8.3 Switch both apps to the kernel and service-kit pieces and delete their own copies (job-service `SignalGracefulShutdown`, `HttpApp`, `LogPolicy`, logging, Redis and health modules, config enums; job-execution-service's inline shutdown, logging, Redis and health wiring, config enums); every scenario test of both apps still passes
- [x] 8.4 Split every constructor into `d: <Class>Deps` and `p: <Class>Params` where it takes configuration values (e.g. the service token, ports, connection names), and rename `DomainErrorProps` to `DomainErrorParams`; verify lint (two-object constructor rule) and all tests pass
- [x] 8.5 Check that no logic is left duplicated between the apps and packages (diff files with the same role), update the Dockerfile for the new package, and verify `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` pass

## 9. Integration: docs and final checks

Owns: `CLAUDE.md`, `DECISIONS.md`, `README.md` · Depends on: 8 · Parallel with: none

- [x] 9.1 Update CLAUDE.md (Architecture: two services, `packages/service-kit` and their real layers-first trees, execution has no database access and job state stays with job-service, `packages/kernel`, `tooling/`; Commands: real scripts including `test:e2e`; Testing: the test levels), add the job-state ownership, internal-access, contract-testing (shared Zod instead of Pact) and code-structure (layers first, interface per class, deps object, Request/Response objects, and their boilerplate cost) trade-offs to DECISIONS.md, and start README.md (how to run, how to run tests, health example request)
- [x] 9.2 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`) and `npm run test:e2e`, and verify they all pass

## 10. Verifier fixes

Owns: `packages/kernel/**`, `packages/service-kit/**`, `apps/job-service/**`, `apps/job-execution-service/**`, `tests/support/**`, root `package.json`, `package-lock.json`, `tooling/**`, `Dockerfile`, `CLAUDE.md`, `README.md` · Depends on: 9 · Parallel with: none

- [x] 10.1 Write failing e2e tests for "Malformed body" (400 `VALIDATION_FAILED`) and "Body too large" (413 `PAYLOAD_TOO_LARGE` with the limit); add `PAYLOAD_TOO_LARGE` to `ERROR_CODES`, set the body limit explicitly, map both body-parser errors and stop passing any framework error through with Nest's body (fix the unit test that asserted the pass-through); verify the tests pass
- [x] 10.2 Move the port setting into service-kit's base env schema (variable name as a param) and remove both apps' copies; verify the config parser tests pass
- [x] 10.3 Move the Redis connection logic out of `app/` into `IoRedisConnection` (`infra/`) behind a `RedisConnection` interface (`domain/`), the module only wiring it; give `PrismaDatabase` a `Database` interface and token in job-service's `domain/`; rename `OrderNotFoundErrorProps`; import `reflect-metadata` the same way in both `main.ts`; verify lint and tests pass
- [x] 10.4 Create the `tests/support` workspace (`@job-queue/test-support`) with the shared spawned-process harness and the Redis connection-count helper, switch both apps' e2e tests to it and delete their copies; verify every e2e scenario test still passes
- [x] 10.5 Write integration tests (`*.int.test.ts`, Testcontainers): `PrismaDatabase` against Postgres (connects, answers a query, disconnects) and `IoRedisConnection` against Redis (connects, answers, quits); verify `npm run test:integration` runs and passes them
- [x] 10.6 Update CLAUDE.md and README.md for `tests/support` and the error codes, then run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` and the language check; verify all pass
- [x] 10.7 Define job-service's bootstrap params (setup steps, config parser, service name) once and use them in both `main.ts` and the in-process e2e harness; move the Postgres connection counter into `tests/support` and use it in the Prisma integration test and the e2e support; remove the unused dependencies (`ioredis` in both apps, `zod` in job-execution-service, `supertest` and `@types/supertest` in job-service) and refresh `package-lock.json`; verify `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration` and `npm run test:e2e` pass
- [x] 10.8 Make the "job-service stopped" test fail if shutdown does not close the database: assert that a termination signal closes the `Database` (in-process, the app's shutdown calls `Database.close()`), keeping the lazy pool (no Postgres connection at startup); update the docs that describe `tests/support` (CLAUDE.md, README.md, its package.json, design.md) for the Postgres connection counter and its use by integration tests; verify the test fails with the close wiring removed and all checks pass
- [x] 10.9 Define the Testcontainers images once (`CONTAINER_IMAGES` in `tests/support`) and use them in every integration and e2e test; update design.md "Repository layout" to the real trees; verify typecheck, lint, `npm test` and `npm run test:integration` pass
- [x] 10.10 Run the `tests/support` unit tests in `npm test` (root Vitest projects include `tests/*`) and fix the DomainError wording in design.md; verify `npm test`, lint and typecheck pass
- [x] 10.11 Anchor the root-only entries in `.prettierignore` (`/docs`, `/openspec`, `/.claude`) so source folders named like them are format-checked, format the files that were hidden, and correct job-service `domain/http/` in design.md "Repository layout"; verify `npm run format:check`, lint, typecheck and `npm test` pass
- [x] 10.12 Make `npm run dev` work without a `.env` (load `.env.example`, then `.env` overrides) and update README.md and CLAUDE.md; verify all three apps start and both `GET /health` answer 200

## Workflow follow-up

- Run the `change-verifier` subagent; it must return PASS.
- Archive the change on its branch after PASS, then merge into `master` with the user's approval.
