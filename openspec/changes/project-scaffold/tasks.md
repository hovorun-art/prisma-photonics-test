# Tasks

## Plan

```
1 Foundation ──┬── 2 job-service: health ─────┐
               ├── 3 job-service: internal ───┼── 6 Docker, CI, docs (integration)
               ├── 4 job-execution-service ───┤
               └── 5 job-ui ──────────────────┘
```
Groups 2, 3, 4 and 5 could run in parallel after 1. Group 4 calls `/internal/v1/ping` through the
contract defined in group 1, so it does not need group 3's code. Group 6 runs last, not in parallel.

## 1. Foundation: workspaces, tooling, shared packages

Owns: `package.json`, `package-lock.json`, `tooling/**`, `vitest.workspace.ts`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.env.example`, `packages/kernel/**`, `packages/contracts/**`, `apps/*/package.json`, `apps/*/tsconfig*.json`, `apps/*/vitest.config.ts`, `tests/system-e2e/package.json`, `tests/system-e2e/tsconfig.json` · Depends on: none · Parallel with: none

- [ ] 1.1 Create the root `package.json` (npm workspaces `apps/*`, `packages/*`, `tests/*`; `engines.node` 26; scripts `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `format`) and the workspace `package.json` files; verify `npm install` succeeds on Node 26, falling back to 24 if a core library (Prisma, NestJS, SWC, Vite) fails, and record which was used
- [ ] 1.2 Add `tooling/` presets (strict tsconfig with `noUncheckedIndexedAccess`, ESLint flat config with typescript-eslint, `eslint-plugin-boundaries` layer rules, no deep imports across modules, composition-root exemption, Prettier) and verify `npm run lint` and `npm run typecheck` pass on an empty tree
- [ ] 1.3 Set up Vitest across workspaces (root `vitest.workspace.ts`, `unplugin-swc` for the Nest apps, separate Vitest projects for unit `*.test.ts`, integration `*.int.test.ts` and backend per-app e2e `test/e2e/*.e2e.test.ts`; `npm test` runs all three, `test:e2e` runs the Playwright suites) and verify `npm test` runs and passes with no tests
- [ ] 1.4 Write failing tests for `packages/kernel`: `DomainError` carries `code`, `message` and `details`; fake `Clock`, `Random` and `Sleeper` behave deterministically
- [ ] 1.5 Implement `packages/kernel` (`DomainError`, `Clock`, `Random`, `Sleeper` ports, system implementations and fakes) and verify 1.4 passes
- [ ] 1.6 Write failing tests for `packages/contracts`: `HealthResponse` schema accepts ok/unavailable shapes with dependency statuses and instance list; `ErrorBody` schema; `ErrorCode` includes `INTERNAL_UNAUTHORIZED` and `INTERNAL_ERROR`; internal ping response schema
- [ ] 1.7 Implement `packages/contracts` (Zod schemas plus inferred types) and verify 1.6 passes
- [ ] 1.8 Write `.env.example` with every variable and the initial values from design.md (ports, URLs, service token placeholder, heartbeat interval and expiry, backoff, probe timeout, polling interval) and update `.gitignore` (`.env`, `dist`, `coverage`); verify `npm run lint` and `npm run typecheck` still pass

## 2. job-service: health, errors, logging, API docs

Owns: `apps/job-service/src/main.ts`, `apps/job-service/src/app.module.ts`, `apps/job-service/src/shared/**`, `apps/job-service/src/health/**`, `apps/job-service/prisma/**`, `apps/job-service/src/**/*.int.test.ts` for its own adapters, `apps/job-service/test/e2e/health*`, `apps/job-service/test/e2e/docs*`, `apps/job-service/test/e2e/support/**` · Depends on: 1 · Parallel with: 3, 4, 5

- [ ] 2.1 Write failing unit tests for the health aggregation, named after the scenarios "All dependencies reachable", "Database unreachable", "Queue store unreachable" and "No instances running"
- [ ] 2.2 Implement the `health` module's domain and application layers (`DependencyProbe` port, live-instance query port, `GetSystemHealth`) and verify 2.1 passes
- [ ] 2.3 Write failing unit tests for live-instance filtering by heartbeat age with a fake clock, for "Running instances are listed" and "Stopped instance disappears"
- [ ] 2.4 Implement the Redis sorted-set adapter that reads and prunes `execution:instances` and verify 2.3 passes
- [ ] 2.5 Set up Prisma in `apps/job-service/prisma` (datasource only, empty initial migration) and the Prisma and Redis probe adapters with the configured timeout; verify `prisma validate` and the typecheck pass
- [ ] 2.6 Write failing tests for the global error filter (a `DomainError` maps to its status and body `{code, message, details}`; an unknown error gives 500 `INTERNAL_ERROR` and is logged)
- [ ] 2.7 Implement config validation (Zod over env), `nestjs-pino` logging with `authorization` redaction, the error filter, `GET /health` (200/503), Swagger at `/docs` from the Zod schemas, and graceful shutdown hooks; verify 2.6 passes
- [ ] 2.8 Write integration tests for the Prisma probe (Postgres container) and the Redis probe and instance adapter (Redis container), and verify they pass
- [ ] 2.9 Write per-app e2e tests (the full app over HTTP, Testcontainers Postgres and Redis, execution instances simulated by writing heartbeats, responses parsed with `HealthResponse`) for "All dependencies reachable", "Database unreachable", "Queue store unreachable", "Running instances are listed", "Stopped instance disappears", "Docs available" and "job-service stopped", and verify they pass

## 3. job-service: internal access

Owns: `apps/job-service/src/internal-access/**`, `apps/job-service/test/e2e/internal*` · Depends on: 1 · Parallel with: 2, 4, 5

- [ ] 3.1 Write failing unit tests for `ServiceTokenGuard` named "Missing token", "Wrong token" and "Valid token" (constant-time comparison, `UnauthorizedInternalAccessError` with code `INTERNAL_UNAUTHORIZED`)
- [ ] 3.2 Implement the guard and `GET /internal/v1/ping` (excluded from Swagger) as an exportable `InternalAccessModule`, and verify 3.1 passes
- [ ] 3.3 Write per-app e2e tests over HTTP for "Missing token", "Wrong token", "Valid token" and "Docs exclude internal routes"; verify they pass against a test module that imports `InternalAccessModule` (group 6 re-runs them against the real app)

## 4. job-execution-service: readiness, heartbeat, shutdown

Owns: `apps/job-execution-service/src/**`, `apps/job-execution-service/test/**` · Depends on: 1 · Parallel with: 2, 3, 5

- [ ] 4.1 Write failing unit tests with a fake `Sleeper`, `Clock` and probes for "Dependency unavailable at startup", "Dependency becomes available" and "Misconfigured token" (backoff grows to the configured cap, each failure logged, no heartbeat before both dependencies are ready)
- [ ] 4.2 Implement the `instance` module (instance id via `Random`, `ReadinessLoop`, `Heartbeat` port and Redis sorted-set adapter) and the `job-service-client` module (port plus HTTP adapter calling `/internal/v1/ping` with the bearer token and a timeout); verify 4.1 passes
- [ ] 4.3 Write failing tests for "Execution instance stopped": on a termination signal the heartbeat stops, the member is removed and the process exits 0
- [ ] 4.4 Implement `main.ts` (Nest application context, config validation, pino with `instanceId`, shutdown hooks; no `DATABASE_URL` in its config schema) and verify 4.3 passes
- [ ] 4.5 Write integration tests for the Redis heartbeat adapter (Redis container) and the job-service HTTP client (local stub server), and verify they pass
- [ ] 4.6 Write per-app e2e tests (the real process spawned, Testcontainers Redis, job-service simulated by a stub server whose responses pass `packages/contracts`) for "Reachability check with token", "Misconfigured token", "Dependency becomes available" and "Execution instance stopped", and verify they pass

## 5. job-ui: reachability text

Owns: `apps/job-ui/**` except `package.json`, `tsconfig*.json`, `vitest.config.ts` (group 1) and `nginx.conf` (group 6) · Depends on: 1 · Parallel with: 2, 3, 4

- [ ] 5.1 Scaffold Vite + React + TypeScript with Tailwind v4 and shadcn/ui initialised (`components.json`, `src/components/ui/`), TanStack Query provider, and a Vite dev proxy from `/api` to job-service; verify `npm run build -w apps/job-ui` succeeds
- [ ] 5.2 Write failing tests (Vitest, Testing Library, MSW) named "Backend reachable", "Backend unreachable" and "Status recovers"
- [ ] 5.3 Implement `features/system-status` (`useHealth` with the configured polling interval, the status text; UI strings from a `locales/en` file) and verify 5.2 passes
- [ ] 5.4 Write per-app e2e tests with Playwright against `vite preview`, every `/api` call intercepted with fixtures validated by `packages/contracts`, for "Backend reachable", "Backend unreachable" and "Status recovers"; verify they pass with `npm run test:e2e -w apps/job-ui`

## 6. Integration: Docker, CI, docs

Owns: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `apps/job-ui/nginx.conf`, `tests/system-e2e/**` except its `package.json` and `tsconfig.json`, `.github/workflows/checks.yml`, `CLAUDE.md`, `DECISIONS.md`, `README.md`, `.claude/flow.conf` · Depends on: 2, 3, 4, 5 · Parallel with: none

- [ ] 6.1 Register `InternalAccessModule` in job-service and verify the group 3 per-app e2e tests pass against the real app
- [ ] 6.2 Write the multi-stage `Dockerfile` (targets `job-service`, `job-execution-service`, `migrate`, `job-ui` with nginx and the `/api` proxy) and `.dockerignore`; verify `docker compose build` succeeds
- [ ] 6.3 Write `docker-compose.yml` (postgres and redis with healthchecks, one-shot `migrate`, job-service depending on it, scalable job-execution-service without DB access, job-ui) and the `npm run dev` flow; verify `docker compose up --scale job-execution-service=2` shows two instances in `GET /health`, the job-ui page shows the backend as reachable, and `docker compose down` exits cleanly
- [ ] 6.4 Write the system e2e suite in `tests/system-e2e` (Playwright; global setup starts the compose stack under its own project name with two execution instances, teardown removes it): `GET /health` lists both instances and passes `HealthResponse`; docs route available and without `/internal`; `/internal/v1/ping` without token, with a wrong token and with the right token; job-ui through nginx shows the backend as reachable; stopping one instance removes it from health. Verify `npm run test:e2e` passes
- [ ] 6.5 Update `.github/workflows/checks.yml` (branch `master`, Node 26, add `docker compose build`, and a job that installs Playwright browsers, runs `npm run test:e2e` and uploads the report on failure) and keep `.claude/flow.conf` `CHECK_CMDS` in sync with the real script names
- [ ] 6.6 Update CLAUDE.md (Architecture: two services, execution reaches job state only through `/internal`, `packages/kernel`, `tooling/`; Commands: real scripts including `test:e2e`; Testing: the test levels), add the job-state ownership, internal-access and contract-testing (shared Zod instead of Pact) trade-offs to DECISIONS.md, and start README.md (how to run, how to run tests, health example request)
- [ ] 6.7 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`) and `npm run test:e2e`, and verify they all pass

## Workflow follow-up

- Run the `change-verifier` subagent; it must return PASS.
- Archive the change on its branch after PASS, then merge into `master` with the user's approval.
