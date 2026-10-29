# Proposal

## Why

Every later change (email job flow, job types, endpoints, reliability) needs a running system to
build on. Right now the repository has only planning documents. This change creates a walking
skeleton: one command starts every service. Each service shows it is alive and connected, and the
checks are green from the first commit. Later changes only add behaviour and never fight the setup.

## What Changes

- An npm workspaces monorepo with the agreed layout: `apps/job-service`, `apps/job-execution-service`,
  `apps/job-ui`, `packages/contracts` and the shared packages the stack needs.
- `docker-compose.yml` and a `Dockerfile` that start Postgres, Redis, job-service,
  job-execution-service and job-ui with one command; job-execution-service can be scaled to several
  instances.
- job-service: a minimal NestJS app, the only service that talks to Postgres, with `GET /health`
  answering 200 `{ "status": "ok" }`, Swagger/OpenAPI docs and the service-token guard for future
  `/internal` routes.
- job-execution-service: a minimal NestJS app that starts, connects to Redis (never Postgres), logs
  that it has started and answers its own `GET /health` with 200 `{ "status": "ok" }`. It runs no
  jobs and calls no other service yet.
- job-ui: a minimal React + Vite app (Tailwind + shadcn/ui, TanStack Query) that shows it has
  started; it does not call the backend yet.
- Prisma set up against Postgres with an initial, empty migration path (no job tables yet).
- The DDD skeleton and conventions in code: layers first (`src/domain`, `src/infra`, `src/app`) with
  features inside, every class behind an interface, one deps object per constructor, Request/Response
  objects for every method, DI tokens, error base class with a closed list of codes, pino logging,
  clock/random/sleeper ports, and ESLint rules that enforce the layers and class shapes.
- Uniform error responses: every API error, including the framework's own (unknown route, invalid
  request), has the same body with a stable code.
- Tooling: strict TypeScript, ESLint + Prettier, Vitest in every workspace, root scripts `typecheck`,
  `lint`, `test`, `build`, `dev`; CI workflow updated to the stack.

## Capabilities

### New Capabilities
- `system-health`: how each part of the running system shows that it is up: both backends answer a
  health check, the execution service announces its start, every service shuts down cleanly, and the
  UI shows that it has started.
- `internal-api-access`: the protection of job-service's future internal methods for
  job-execution-service (`/internal` prefix, service token, hidden from the public documentation),
  and the rule that the execution service has no database access.
- `api-errors`: the shape of every error response the API returns (`code`, `message`, `details`), the
  closed set of codes, and how the framework's own errors (unknown route, invalid request) map to it.

### Modified Capabilities
- None.

## Impact

- New: all application code, `docker-compose.yml`, `Dockerfile`, root `package.json` and workspace
  configs, Prisma schema, ESLint/Prettier/Vitest/TypeScript configs.
- Modified: `DECISIONS.md` (execution talks to job-service over HTTP instead of sharing the
  database), `.github/workflows/checks.yml` (Node 26, workspace commands, branch `master`),
  `.gitignore`, `CLAUDE.md` (Commands and Architecture: execution reaches job state over HTTP, not
  in-process), `.claude/flow.conf` (only if script names differ).
- Dependencies: NestJS, Prisma, BullMQ/ioredis, Zod, pino, React, Vite, Tailwind, shadcn/ui,
  TanStack Query, Vitest, ESLint, Prettier.
