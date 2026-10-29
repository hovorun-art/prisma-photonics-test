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
- job-service: a minimal NestJS app, the only service that talks to Postgres, with a health endpoint
  that reports Postgres, Redis and the live job-execution-service instances, plus Swagger/OpenAPI docs.
- job-execution-service: a minimal NestJS app that starts, connects to Redis, reaches job-service over
  HTTP (it never touches Postgres) and publishes a heartbeat. It runs no jobs yet. Its access to job
  state goes through a Job-context port whose adapter calls job-service's internal update method.
- job-ui: a minimal React + Vite app (Tailwind + shadcn/ui, TanStack Query) that loads and shows whether
  the backend is reachable.
- Prisma set up against Postgres with an initial, empty migration path (no job tables yet).
- The onion/DDD skeleton and conventions in code: module layers, DI tokens, error base class with
  codes, pino logging, clock/random ports, ESLint boundary rule.
- Tooling: strict TypeScript, ESLint + Prettier, Vitest in every workspace, root scripts `typecheck`,
  `lint`, `test`, `build`, `dev`; CI workflow updated to the stack.

## Capabilities

### New Capabilities
- `system-health`: how the running system reports whether its services and their dependencies
  (database, queue) are available, through the API and the UI. Queue statistics are added to it later
  by `queue-health`.
- `internal-api-access`: job-service's internal methods for job-execution-service (`/internal`
  prefix, service token, hidden from the public documentation), and the rule that the execution
  service reaches job state only through them, never through the database.

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
