# Project

Job Queue Service: an interview task (Senior AI-Integrated Full Stack Engineer). Clients submit
background jobs (email, webhook, aircraft transit report, batch) through an API; workers pull them
from a Redis queue (BullMQ) and execute them, with job state, results and logs in Postgres; a web UI (job-ui) lists,
inspects, cancels and retries jobs and shows aircraft transits on a map. The reviewers assess
concurrency, failure handling and state management (duplicate-free pickup, crash recovery, retry
with backoff, priority, scheduled jobs, idempotency) and the honesty of `DECISIONS.md`. Spec-driven with OpenSpec; the flow's hooks, skills and verifier agent live in `.claude/`.
The full concept is in `docs/concept.md` (a source for decisions; each point is decided in a change).

## Language

English only: specs, design, tasks, code, comments, identifiers, UI strings in code, commit
messages and docs. Other languages only inside dedicated translation files (e.g. `locales/`);
text shown to users must come from those files, never be hardcoded in code.
Chat with the user and AskUserQuestion questions/options may be in the user's language; files stay
English. Deliberate exceptions (e.g. a test for Cyrillic input) carry `allow-non-english` on the line
or match `LANGUAGE_IGNORE` in `.claude/flow.conf`.

## Git

- Never commit, amend, push, merge, rebase or reset without the user's explicit approval. When work
  is ready to commit, show what will go in and the message; a hook makes Claude Code ask before each
  such git command. One approval covers one command, not later ones. Never route around the prompt
  (other tools, `--no-verify`, scripts).
- New features are built on their own branch, never on the main branch (`MAIN_BRANCH` in
  `.claude/flow.conf`): one branch per change, named after the change (`<change>`), created before
  the first planning artifact. Planning (`openspec/changes/<change>/`), code and the archive all go on
  that branch; the main branch only receives the merge, which brings the code and the updated main
  specs together.

## Testing (TDD)

- Tests come first. For each task: write the test, run it and see it fail for the expected reason,
  write the least code that makes it pass, then refactor with the tests green.
- Every spec scenario (WHEN/THEN) has at least one test that sets up its WHEN and asserts its THEN;
  name the test after the scenario so the verifier can trace it.
- Fix the code, not the test. Change a test only when it contradicts the spec, and then say so.
- Tests are deterministic: time, randomness and I/O come in through injected ports. In unit tests
  mock a class's dependencies with `mockDeep<Port>()` from `vitest-mock-extended` and pass them as
  its `d: <Class>Deps` object; time with Vitest's own tools (`vi.useFakeTimers()`,
  `vi.setSystemTime()`). Stub each expected call with the `...Once` forms (`mockResolvedValueOnce`,
  `mockRejectedValueOnce`, `mockReturnValueOnce`, `mockImplementationOnce`), never the persistent
  ones, so an unexpected extra call gets nothing and fails; ESLint enforces it in test files. No
  shared fake packages, and no tests for test doubles.
- Test data never comes from our own app code (e.g. the kernel `Random`): ids and other generated
  values come from Node directly (`randomUUID()` from `node:crypto`), held in a named constant when a
  test compares the same value twice; no hardcoded UUID literals.
- One test file per source file (`random.ts` → `random.test.ts`), next to it; no grab-bag test
  files. Test behaviour, not language facts: no tests that a token is a `symbol` or that a
  constant exists.
- Levels: unit (`*.test.ts` next to the code), integration (`*.int.test.ts`, one adapter against
  its real dependency via Testcontainers), per-app e2e (`apps/<app>/test/e2e/`, the app as a black
  box with its own infrastructure, other apps simulated), contract checks through the shared Zod
  schemas (no Pact), system e2e (`tests/system-e2e`, full compose stack, Playwright).
- Per-app backend e2e (`apps/<app>/test/e2e/`): one `*.e2e.test.ts` file per spec area (in
  job-service: `service`, `errors`, `jobs` and `internal-jobs`). Next to them there is exactly one
  small shared file (`<app>-under-test.ts`, one class): it starts the app as described below,
  and holds the HTTP calls, error-body checks and seeding the test files share. It is not a support
  folder: no fixture, launcher, probe-module or fake-service classes.
  - The app's own database is real: a fresh Postgres Testcontainer per file, migrated with the
    app's migrations and emptied before each test.
  - Everything outside the app is mocked at its domain port with `mockDeep<Port>()`: the queue,
    the Redis connection and other services' HTTP clients. Mocks are swapped in through
    `Test.createTestingModule({ imports: [AppModule.forRoot({ config })] })` and
    `.overrideProvider(TOKEN).useValue(mock)`, and reset with `mockReset` before each test.
  - Build the config with the app's own config parser, apply the bootstrap's own list of setup
    steps (e.g. `JOB_SERVICE_SETUP_STEPS`, never a copy of it), `listen(0, '127.0.0.1')`, and
    call the routes with `fetch`.
  - Drive the app only through its HTTP API. When a test needs data in a state no route can
    create, store it through the app's own repository, taken from the DI container
    (`app.get(TOKEN)`).
  - Assert on HTTP responses (parsed with the contract schemas) and on the calls the mocks
    received (`toHaveBeenCalledExactlyOnceWith`). To simulate an outage, make the stub reject
    once (`mockImplementationOnce`) instead of pointing the app at an address that can't be
    reached.
  - No probe controllers: test error responses through the real routes. For an unexpected
    failure, make a real provider throw once (`vi.spyOn(app.get(TOKEN), 'method')
    .mockRejectedValueOnce(...)`, restored after each test).
  - Shutdown is tested in the same process: start a second app with its own mocks, call
    `app.close()`, and assert that each connection (database, queue, Redis) was closed once.
  - What this level can't see is covered elsewhere: the adapters' real behaviour by their
    `*.int.test.ts`, signal handling by the kernel's unit tests, and the whole running system by
    the system e2e.
- After writing or changing tests, run the `test-case-reviewer` subagent in the foreground on that
  area. Give it only the app and test level (or the file), not your own reasoning, so it judges the
  cases independently. Add the missing corner cases it reports, or tell the user why a case does
  not belong to that area.
- With `TDD_STRICT=1` in `.claude/flow.conf`, a hook blocks edits to source files until a test file
  has changed on the branch.

## Commands

Keep in sync with `CHECK_CMDS` in `.claude/flow.conf`. Root scripts run across all workspaces.
- `docker compose up --build --wait` (whole stack), `docker compose up --scale job-execution-service=N`
  (several workers); `docker compose down -v` to remove it
- `npm run dev`: Postgres and Redis in Docker, the three apps on the host in watch mode (reads
  `.env.example`, then `.env` overrides)
- `npm run build` (shared packages first: `npm run build:packages`)
- `npm run typecheck`, `npm run lint`, `npm test` (all three run by the Stop hook); `npm test` runs
  unit, integration and backend per-app e2e (Testcontainers, needs Docker); `npm run test:unit`,
  `npm run test:integration` for one level
- `npm run test:e2e`: job-ui Playwright and the system e2e on a compose stack (CI and the verifier)
- `npm run format` / `npm run format:check`

## Purpose and decisions

A take-home assessment, built to production-like standards but scoped to the task. The full list
of planning decisions is in `docs/concept.md` ("Decided during planning"); design trade-offs for the
reviewers go into `DECISIONS.md` as they are made, not at the end.

- Node 26, TypeScript, npm workspaces monorepo.
- Backend: NestJS, two apps (`job-service`, `job-execution-service`). Database: Postgres via Prisma (raw SQL via `$queryRaw` where
  concurrency-critical queries need locking). Queue: BullMQ on Redis behind our own queue interface
  (enqueue, claim, complete, fail, cancel), so its internals can be replaced later; what BullMQ does
  and what we own is in `DECISIONS.md`.
- job-ui: React + Vite, Tailwind + shadcn/ui, Leaflet + react-leaflet (OpenStreetMap tiles). Updates by
  polling first; Server-Sent Events later if time allows.
- Contracts: Zod schemas in `packages/contracts`, shared by the backend (validation pipe, OpenAPI
  generation) and job-ui. REST + OpenAPI, not tRPC: other services must be able to call the API.
- API docs: Swagger/OpenAPI generated from the Zod schemas.
- Tests: Vitest in every workspace; integration tests run against real Postgres and Redis.
- Aircraft data: generated from a bundled static airport list, no external API.
- Submission files: `README.md`, `DECISIONS.md`, `AI_USAGE.md`, `docs/ai-chats/` (Markdown exported
  from Claude Code sessions by a script at the end), `Dockerfile`, `docker-compose.yml`.

Specs must describe user-visible behaviour, not implementation details, so they stay reusable if
the stack changes.

## Architecture

DDD with onion layers, layers first (see "Code style"). Current layout:
```
apps/job-service            Job bounded context (owns the Job aggregate and job logs): GET /health,
                            Swagger at /docs, the error filter, the /internal guard, the job API
                            (/v1/jobs: create, get, query, delete; /internal/v1/jobs: get, update)
                            over one JobService; jobs table via Prisma, BullMQ queue behind JobQueue.
                            src/{domain,infra,app}/ + main.ts; prisma/ (schema, migrations)
apps/job-execution-service  Job Execution context: takes queued attempts (BullMQ behind JobQueueConsumer),
                            reads and reports jobs through job-service's internal API (JobRepository),
                            runs them with the JobHandler of their type (JobExecution); GET /health on
                            a port that is not published. Scaled with
                            `docker compose up --scale job-execution-service=N`. Domain modules, each
                            behind JobHandler so it can become its own microservice:
                              notifications (email, today), webhooks, flight-transit, batch-processing
apps/job-ui                 React + Vite UI (today: the started page), src/features/<feature>/
packages/kernel             framework-free: Clock, Random, Sleeper ports, DomainError + ERROR_CODES,
                            SignalGracefulShutdown, ProcessFatalErrorHandler, the job errors shared by
                            both backends (JobNotFoundError, JobStatusConflictError)
packages/contracts          Zod schemas and inferred types: health response, error body, internal
                            API prefix and token scheme, the Job entity (jobs/job.ts: statuses,
                            types, limits, payloads, results, requests) and the queue message
packages/service-kit        shared NestJS pieces for the backends: NestServiceBootstrap, base config
                            (NODE_ENV, LOG_LEVEL, REDIS_URL, port, INTERNAL_SERVICE_TOKEN), logging with redaction, Redis module,
                            health module, config module
tests/support               test-only helpers for the integration and e2e tests (spawned-service
                            harness, Redis and Postgres connection counters, Prisma migrate deploy
                            for test databases); a dev dependency,
                            never in a runtime image
tests/system-e2e            Playwright suite against the full compose stack
tooling/                    shared tsconfig, ESLint (layer and class rules) and Vitest presets
Dockerfile                  one multi-stage file: job-service, job-execution-service, migrate, job-ui (nginx)
docker-compose.yml          postgres, redis, migrate (one-shot), job-service, job-execution-service, job-ui
```
- Postgres is the source of truth for job state and only job-service touches it;
  job-execution-service has no database access and will change job state only through
  job-service's `/internal` API (service token). Redis only holds the queue. BullMQ is used only
  through our queue interface; how it maps to Postgres state is in `DECISIONS.md` (queue entries
  carry only the job id, one entry per attempt).
- Health checks report only their own process (`GET /health` → 200 `{ "status": "ok" }`), never
  related services, so services waiting on each other's health cannot deadlock.
- No logic is written twice: framework-free shared code goes to `packages/kernel`, NestJS-bound
  shared code to `packages/service-kit`; apps add their own parts through params.
- Time (clock), randomness (webhook failure rate, sleep durations, generated flight data) and
  sleeping come in through injected ports, so execution and job handlers test deterministically.

## Code style

**Backend modules (DDD + onion).**
- Layers first: every app's `src/` has exactly `domain/`, `infra/` and `app/` (plus `main.ts`).
  Features go inside each layer as subfolders (`domain/health/`, `infra/health/`,
  `app/health/`), with deeper subfolders when they divide the code logically
  (`infra/health/redis/`). The same layout applies to `packages/kernel/src` and `packages/service-kit/src`.
  - `domain/`: only what is not implemented: interfaces (ports and use cases) with their
    Request/Response types and DI token, value types, and domain errors. No classes with logic, no
    NestJS, Prisma, Redis or pino imports.
  - `infra/`: every implementation of a `domain/` interface: use-case logic and adapters (Prisma,
    Redis, BullMQ, HTTP clients, pino).
  - `app/`: NestJS entry points (controllers, guards, filters, lifecycle hooks) and the Nest wiring
    (`app/app.module.ts`, `app/<feature>/<feature>.module.ts`); entry points call `domain/`
    interfaces through DI tokens.
  Dependencies: `domain/` imports only `packages/kernel`, contract types and other `domain/` files;
  `infra/` imports `domain/`, `infra/`, kernel and contracts; `app/` imports `domain/`, kernel and
  contracts, and only `*.module.ts` files import `infra/` to wire it.
- Interfaces first: every class implements an interface (from `domain/`, the kernel, or a framework
  interface such as Nest's `CanActivate`). No standalone classes. Bound to their interface through
  Nest DI with a `Symbol` token.
- No free functions: all logic lives in class methods. A helper used by one class is a `private`
  method of it (e.g. `private isStopped(signal)`). Exempt: React components and hooks, `main.ts`,
  configuration files.
- Constructors take at most two objects: `d: <Class>Deps` (collaborators: ports, clients,
  loggers) and, when the class needs configuration, `p: <Class>Params` (values and options:
  intervals, tokens, ports, extra steps), always with named properties, never positional values:
  `constructor(private readonly d: HeartbeatLoopImplDeps, private readonly p: HeartbeatLoopImplParams)`.
  A class with only data (an error) takes just `p`. Modules build both with `useFactory`. Exempt:
  classes Nest instantiates itself (controllers, guards, filters, hooks), which keep Nest's
  per-parameter injection.
- Every public method that has inputs takes one request object and every public method returns
  one response object (or a Promise of it), named `<Method><Interface>Request` /
  `<Method><Interface>Response`, e.g. `HeartbeatLoop.run(req: RunHeartbeatLoopRequest):
  Promise<RunHeartbeatLoopResponse>`. A method without inputs takes no parameter at all (no empty
  request object): `clock.now()` returns `NowClockResponse`. Applies to kernel ports too. Exempt:
  framework-owned signatures (`canActivate`, `catch`, `onApplicationBootstrap`, controller handlers
  returning contract types).
- Implementation names: `<Tech><Interface>` when a technology or strategy distinguishes it
  (`RedisHeartbeat`, `PrismaDependencyProbe`); `<Interface>Impl` only when there is nothing
  meaningful to distinguish it by yet (`HeartbeatLoopImpl`). File names follow the class
  (`redis-heartbeat.ts`, `heartbeat-loop.impl.ts`). Test fakes: `Fake<Interface>`.
- Features use each other only through `domain/` interfaces and their DI tokens, never another
  feature's `infra/` class. Calls between features must work if the other side later becomes a
  remote service: plain data in and out (contract types), no shared entities, no shared
  transactions across features.
- `job-execution-service` changes job state only through job-service's internal API, never by
  writing the Job table directly.
- Name things after the domain (Job, JobLog, Execution, Transit), not after technical roles
  (processor, manager, helper, utils).

**Validation and contracts.** Every request, job payload and job result has a Zod schema in
`packages/contracts`; types are inferred from the schemas (`z.infer`), never written twice. Input is
validated at the edge (HTTP and queue consumers); inner layers trust their types.

**Errors.** Our own error classes extending `DomainError`, each with a stable `code` from the
closed list `ERROR_CODES` in `packages/kernel` (a code outside it does not compile; contracts build
the `ErrorCode` schema from the same list), plus structured `details`. A new failure adds its code to
`ERROR_CODES` first (today: `INTERNAL_UNAUTHORIZED`, `ROUTE_NOT_FOUND`, `VALIDATION_FAILED`,
`PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `JOB_NOT_FOUND`, `JOB_STATUS_CONFLICT`, `QUEUE_UNAVAILABLE`, `JOB_SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`); a code also needs its HTTP status in the filter's table. Code handles errors by class or `code`, never by
message text. `domain/` interfaces declare these errors and `infra/` code throws them; one exception filter per app maps
codes to HTTP status and a uniform response body (`code`, `message`, `details`). Never throw strings
or bare `Error` for expected failures; unknown errors, including framework errors with no code of
our own, are logged and returned as a generic 500 (no framework error body passes through).

**Frontend.** Feature folders (`features/jobs`, `features/transit-map`, ...), each with its own
components, hooks and API calls. Server state through TanStack Query (polling for live updates);
shadcn components in `components/ui`; no global store unless a real need appears. API calls use the
types from `packages/contracts`.

**General.**
- TypeScript `strict` with `noUncheckedIndexedAccess`; no `any` (use `unknown` and narrow).
- ESLint + Prettier; formatting is never discussed in review.
- Structured logging with pino (JSON); every log line in job handling carries `jobId` and, in
  execution, the worker instance id.
- Conventional Commits: `type(scope): summary`, e.g. `feat(job-service): ...`,
  `fix(job-execution-service): ...`, `docs: ...`. Small commits, one logical step each.

## Asking

- Ask through the AskUserQuestion tool, never as a plain-text list in chat. Batch related questions:
  up to 4 per call (each one is a tab), more calls if there are more, blocking questions first.
- Each question has prepared answer options (2-4, recommended one first) plus the built-in "Other";
  single choice by default, multiSelect when several answers can apply together.
- Record the answers in the change's `decisions.md` after each call.
- Libraries: when a library could do something (retries, parsing, scheduling...), do not hand-write
  it and do not pick one yourself. Collect the candidates with their usage and fit (weekly npm
  downloads, latest version and its date, TypeScript types, ESM/CJS, the features the task needs)
  and let the user choose through AskUserQuestion. Record the choice in `decisions.md` and, with the
  numbers and the reason, in `DECISIONS.md`.
- Next steps: when a step ends and the next one is a command (`/apply <change>`,
  `/archive <change>`, a commit...), offer the likely next steps as options instead of
  telling the user to type them, and run the one they pick yourself (skills through the Skill tool).

## Workflow

0. Roadmap first: at the start of the project (while `docs/roadmap/` still has its TODO), run the
   `roadmap` skill to turn `docs/concept.md` into milestones and an ordered list of changes.
   Take each new change from it, and update it when the concept changes.
1. `/explore` to clarify, then `/propose "idea"`. The `spec-flow` schema
   (`openspec/schemas/spec-flow/`) orders the artifacts: proposal → `decisions.md` → the user's
   approval → specs, design → tasks.
   - `decisions.md` has "Decided" (only what the user said or confirmed), "Assumed" (minor defaults
     you propose, confirmed by the user in one batch) and "Open questions" (everything else).
     Never invent behaviour: anything bigger than a minor default is a question.
   - Approval comes only from the user: they type `/specs-go <change>` or pick
     "Approve decisions" when you offer it. A hook then writes `.decisions-approved`, and only when
     nothing in `decisions.md` is unchecked. Until then hooks block specs, design and tasks, and no
     agent may write the marker.
   - UI from screenshots: when the user shares a screenshot or mockup, run the
     `ui-from-screenshots` skill.
   - No numbers in specs: tunable values (speeds, timings, limits, sizes) live in config and may be
     recorded in `decisions.md`, `design.md`, `tasks.md` and `ui.md`; specs say "the configured ...".
2. Commit the planning artifacts on the change's own branch (with the user's approval), then implement
   there with `/apply`, test first. Sequential by default; parallel groups
   only if the user chooses it (the apply skill describes how).
3. Hooks enforce the loop (settings in `.claude/flow.conf`): lint on each edit, full checks at the
   end, then the `change-verifier` subagent must return PASS before the work is done. Run it
   in the foreground and wait for it. Its verdict is recorded by a hook from its final message; no
   agent writes `.verdict`.
4. `/archive` after PASS, on the change branch.

Small fixes: a bug fix or change that adds no new behaviour may skip OpenSpec. It still gets its own
branch (`fix/<name>`), a test that reproduces the bug and fails first, then the fix and green checks.
If it turns out to change what the user sees, stop and start a change instead. When it is unclear
which path fits, ask the user.

## Models

- Main agent: Opus by default (`"model": "opus"` in `.claude/settings.json`), since most tasks
  are non-trivial (new features, architecture, multi-file).
- For purely routine work (small fixes, renames, boilerplate, docs) switch with `/model sonnet`
  at medium effort.
- `change-verifier`: Opus (set in its frontmatter). A false PASS costs more than the extra tokens.
- Choose by measured cost per task, not by price per token.
