# Tasks

## Plan

```
1 (deps, contracts, error code, ports, config, compose, locales)
├─► 2 (service-kit: pino → Redis Stream destination)
│     ├─► 3 (job-service: ClickHouse store, stream, writer, wiring) ─► 4 (job-service: read API + e2e)
│     └─► 5 (log lines in both backends, job-execution-service wiring)
└─► 6 (job-ui: Log card)
7 (integration: docs, system e2e, full checks) after all.
```

Could run in parallel (disjoint files): 2 with 6; then 3, 5 and 6; then 4, 5 and 6. Group 7 runs
last, alone.

Group 1 adds `LOG_STORE_UNAVAILABLE` and the config fields together with every place that must
compile against them (the filter's status table, the config parsers), so every workspace still
typechecks after it.

## 1. Foundations

Owns: `package.json`, `package-lock.json`, `apps/job-service/package.json`, `packages/service-kit/package.json`, `packages/kernel/src/domain/error-codes.ts`, `packages/contracts/src/errors.test.ts`, `packages/contracts/src/jobs/job-log.ts`, `packages/contracts/src/jobs/job-log.test.ts`, `packages/contracts/src/jobs/index.ts`, `apps/job-service/src/app/errors/error-response.filter.ts`, `apps/job-service/src/domain/job-log/**` (ports, Request/Response types, tokens, `errors/log-store-unavailable.error.ts` and its test), `apps/job-service/src/domain/config/job-service-config.ts`, `apps/job-service/src/infra/config/zod-job-service-config-parser.ts`, `apps/job-service/src/infra/config/zod-job-service-config-parser.test.ts`, `packages/service-kit/src/domain/config/base-config.ts`, `packages/service-kit/src/domain/config/base-env-schema.ts`, `packages/service-kit/src/infra/config/zod-base-env-schema.ts`, `packages/service-kit/src/infra/config/zod-base-env-schema.test.ts`, `.env.example`, `docker-compose.yml`, `apps/job-ui/src/locales/en.ts` · Depends on: none · Parallel with: none

- [ ] 1.1 Install `@clickhouse/client` in job-service and `@testcontainers/clickhouse` as a dev dependency where the integration and e2e tests need it (decided versions or newer); verify `npm ls @clickhouse/client @testcontainers/clickhouse` resolves and `npm run build:packages` passes
- [ ] 1.2 Write failing tests in `job-log.test.ts`: `JobLogEntry` parses a full entry and one without attempt and instance id; `JobLogStreamMessage` rejects an unknown level, a non-UUID id or job id and a negative attempt; `JobLogCursor` round-trips a stream id and rejects a value it did not issue ("Malformed cursor"); `QueryJobLogRequest` accepts no parameters, one and two `level` values and rejects `level=debug` ("Unknown level") and a non-positive `limit`; `QueryJobLogResponse` accepts a null `nextCursor`. Run `npm run test:unit -w packages/contracts` and see them fail
- [ ] 1.3 Add the contract (design §8) and export it from `jobs/index.ts`; verify 1.2 passes
- [ ] 1.4 Write a failing test in `errors.test.ts` that `ErrorCode` accepts `LOG_STORE_UNAVAILABLE`; add it to kernel `ERROR_CODES` and to the filter's table as 503; verify the test passes and `npm run typecheck` passes
- [ ] 1.5 Add job-service `domain/job-log/`: `JobLogStore` (insert batch, query), `JobLogSchema` (apply), `JobLogStream` (read batch, ack, lease), `JobLogWriter` (start, stop), `JobLogService` (query), each with Request/Response types and a `Symbol` token, and `LogStoreUnavailableError` (code `LOG_STORE_UNAVAILABLE`) with its unit test; verify `npm run typecheck -w apps/job-service` and the error's test pass
- [ ] 1.6 Write failing config tests for the new variables (design §9: ClickHouse URL and credentials, retention days, query default/max limit, batch size, flush interval, store retry delays in job-service; `JOB_LOG_STREAM_MAX_LENGTH` in the base config): defaults, a valid override, and rejection of non-positive numbers and default limit above max; add them to the configs, parsers and `.env.example`; verify the tests pass
- [ ] 1.7 Add the `clickhouse` service to `docker-compose.yml` (current stable `clickhouse/clickhouse-server` tag, volume, credentials from env, `/ping` healthcheck), the ClickHouse variables on job-service with `depends_on: service_healthy`, and `clickhouse` to the `docker compose up -d` list of the root `dev` script; verify `docker compose config` is valid and `docker compose up -d clickhouse --wait` gets healthy
- [ ] 1.8 Add the Log card strings to `en.ts` (`log.title` "Log", level buttons All/Info/Warning/Error, `log.empty` "No log entries yet", `log.emptyLevel` "No info entries" / "No warning entries" / "No error entries", `log.unavailable` "Log unavailable", the attempt and metadata labels); verify `npm run typecheck -w apps/job-ui` passes
- [ ] 1.9 Run the `test-case-reviewer` subagent on `packages/contracts` unit tests (`src/jobs/job-log.test.ts`, `src/errors.test.ts`), job-service unit tests (`src/infra/config/zod-job-service-config-parser.test.ts`, `src/domain/job-log/errors/`) and service-kit unit tests (`src/infra/config/zod-base-env-schema.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 2. Producer: pino lines to the Redis Stream (service-kit)

Owns: `packages/service-kit/src/domain/job-log/**`, `packages/service-kit/src/infra/job-log/**`, `packages/service-kit/src/app/logging/logging.module.ts`, `packages/service-kit/src/app/logging/logging.module.test.ts`, `packages/service-kit/src/index.ts` · Depends on: 1 · Parallel with: 6

- [ ] 2.1 Write failing unit tests in `job-log-stream-destination.test.ts` (`mockDeep` Redis port, `Random` port), named after "Log line becomes an entry" (a warn line with `jobId` → one `XADD` with `MAXLEN ~` and the configured length, level `warning`, same message, attempt, instance id, source, `ts` from `time`), "Debug line is not an entry", a line without `jobId` (no `XADD`), "Secrets and stacks stay out of the entry" (redacted field kept as redacted, `err.stack` removed, pino's own fields not in metadata) and "Entry cannot be sent" (`XADD` rejects once → `write` does not throw, one warning line with `droppedJobLogEntry` and `jobId` on the main destination, and that line produces no `XADD`). See them fail
- [ ] 2.2 Implement `JobLogStreamDestination` (design §2) behind `LogDestination`, with its own Redis connection (no offline queue, no retries) and `Closable`; verify 2.1 passes
- [ ] 2.3 Write a failing integration test `job-log-stream-destination.int.test.ts` against real Redis (Testcontainers): written lines appear in the stream in order; with a small max length the stream stays near it; a stopped Redis makes `write` return without throwing. See it fail, then make it pass
- [ ] 2.4 Write a failing test in `logging.module.test.ts`: with `jobLog` set, an info line goes to both the main destination and `jobLog`, a debug line only to the main one, and redaction applies to both; implement the `pino.multistream` option in `LoggingModule.forRoot` (pretty stream in development) and export the destination from `index.ts`; verify the test passes
- [ ] 2.5 Run the `test-case-reviewer` subagent on service-kit unit tests (`src/infra/job-log/job-log-stream-destination.test.ts`, `src/app/logging/logging.module.test.ts`) and integration tests (`src/infra/job-log/job-log-stream-destination.int.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 3. job-service: ClickHouse store, stream reader and writer

Owns: `apps/job-service/src/infra/job-log/**`, `apps/job-service/src/app/job-log/job-log-writer.hook.ts`, `apps/job-service/src/app/job-log/job-log-writer.hook.test.ts`, `apps/job-service/src/app/job-log/job-log.module.ts`, `apps/job-service/src/app/app.module.ts` · Depends on: 1, 2 · Parallel with: 5, 6

- [ ] 3.1 Write failing integration tests `clickhouse-job-log-store.int.test.ts` (`@testcontainers/clickhouse`): schema apply is idempotent and sets the configured TTL; query returns one job's entries in stream order, at most `limit`, after a cursor, filtered by levels; "Writer crash after storing a batch" (the same batch inserted twice reads once); "Expired entries" (entries older than retention are gone after `OPTIMIZE TABLE ... FINAL`); a stopped container makes insert and query throw `LogStoreUnavailableError`. See them fail
- [ ] 3.2 Implement `ClickHouseJobLogSchema` and `ClickHouseJobLogStore` (design §5); verify 3.1 passes
- [ ] 3.3 Write failing integration tests `redis-job-log-stream.int.test.ts` (Redis Testcontainer): the group is created once (BUSYGROUP ignored); a read returns at most the batch size; unacknowledged entries are read again by the next start; acknowledged ones are not; only one instance holds the lease at a time and it passes on after expiry. See them fail, then implement `RedisJobLogStream` and verify they pass
- [ ] 3.4 Write failing unit tests `job-log-writer.impl.test.ts` (`mockDeep` stream and store ports, fake timers, `Sleeper`): a full batch is stored at once; a partial batch after the flush interval; ack only after the insert succeeded; "Log store down while a job runs" at unit level (insert rejects once, the same batch is retried after the backoff delay and acked after success, nothing new read meanwhile); backoff doubles up to the max; a malformed message is logged and acked; stop ends the loop without acking an unstored batch; no lease → no read. See them fail
- [ ] 3.5 Implement `JobLogWriterImpl` (design §4); verify 3.4 passes
- [ ] 3.6 Write a failing test for the lifecycle hook (start on bootstrap, stop on shutdown, schema applied before the writer starts); implement the hook and `JobLogModule` (ClickHouse client, Redis stream, writer, schema; closed on shutdown) and import it in `app.module.ts`; in `app.module.ts` also pass a `JobLogStreamDestination` (source `job-service`) as `jobLog` to `LoggingModule.forRoot`, taken from an `AppModule.forRoot` param so tests can pass their own, and close it on shutdown; verify the test passes and the existing job-service e2e files still pass with `JOB_LOG_SCHEMA`, `JOB_LOG_STORE` and `JOB_LOG_WRITER` overridden by mocks (group 4 adds that override to `job-service-under-test.ts`; until then run them with a local ClickHouse from `docker compose up -d clickhouse`)
- [ ] 3.7 Run the `test-case-reviewer` subagent on job-service unit tests (`src/infra/job-log/job-log-writer.impl.test.ts`, `src/app/job-log/job-log-writer.hook.test.ts`) and integration tests (`src/infra/job-log/clickhouse/clickhouse-job-log-store.int.test.ts`, `src/infra/job-log/redis/redis-job-log-stream.int.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 4. job-service: read API

Owns: `apps/job-service/src/infra/job-log/job-log-service.impl.ts`, `apps/job-service/src/infra/job-log/job-log-service.impl.test.ts`, `apps/job-service/src/app/job-log/job-log.controller.ts`, `apps/job-service/src/app/job-log/job-log.dto.ts`, `apps/job-service/test/e2e/job-log.e2e.test.ts`, `apps/job-service/test/e2e/job-service-under-test.ts`, `apps/job-service/test/e2e/service.e2e.test.ts` · Depends on: 3 · Parallel with: 5, 6

- [ ] 4.1 Write failing unit tests `job-log-service.impl.test.ts` (`mockDeep` `JobRepository` and `JobLogStore`): unknown job → `JobNotFoundError` without a store call; `nextCursor` is the last entry's cursor, the given `after` when nothing is returned, null when neither; the default limit is used when none is given. See them fail, then implement `JobLogServiceImpl` and verify they pass
- [ ] 4.2 In `job-service-under-test.ts`: start a ClickHouse container only when asked, otherwise override `JOB_LOG_SCHEMA`, `JOB_LOG_STORE` and `JOB_LOG_WRITER` with `mockDeep` mocks; add `jobLog(id, query)` and seeding through `app.get(JOB_LOG_STORE)`; verify the existing e2e files pass without ClickHouse
- [ ] 4.3 Write failing e2e tests `job-log.e2e.test.ts` (real Postgres and ClickHouse, writer and stream mocked), named after "Read a job's log", "Read only newer entries", "Nothing new", "Job with no entries yet", "Paging with limit", "Only error entries", "Two levels", "Entry fields", "Id is not a UUID", "Limit above the maximum", "Unknown level", "Malformed cursor", "Unknown job", "Deleted job" and "Log store down on read" (store query rejects once with `LogStoreUnavailableError` → 503, `GET /v1/jobs/:id` still 200). See them fail
- [ ] 4.4 Add `QueryJobLogDto` and `JobLogController` (`GET /v1/jobs/:id/logs`) with Swagger metadata; register it in `JobLogModule`; verify 4.3 passes
- [ ] 4.5 Add "Log route in the API docs" to `service.e2e.test.ts` (the route with `limit`, `after`, `level` and its response schema); verify it passes
- [ ] 4.6 Run the `test-case-reviewer` subagent on job-service unit tests (`src/infra/job-log/job-log-service.impl.test.ts`) and per-app e2e (`test/e2e/job-log.e2e.test.ts`, `test/e2e/service.e2e.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 5. Job-related log lines and destination wiring

Owns: `apps/job-service/src/infra/jobs/job-service.impl.ts`, `apps/job-service/src/infra/jobs/job-service.impl.test.ts`, `apps/job-execution-service/src/infra/execution/job-execution.impl.ts`, `apps/job-execution-service/src/infra/execution/job-execution.impl.test.ts`, `apps/job-execution-service/src/app/app.module.ts`, `apps/job-execution-service/src/infra/bootstrap/job-execution-service-bootstrap.ts`, `apps/job-execution-service/src/infra/bootstrap/job-execution-service-bootstrap.test.ts` · Depends on: 2 · Parallel with: 3, 4, 6

- [ ] 5.1 Review every `logger.*` call that carries `jobId` in both backends for fields that must not reach API clients; note the result in the group's commit message
- [ ] 5.2 Write failing unit tests in `job-service.impl.test.ts` (mocked logger), named after "Submitted and queued job is logged" (`Job submitted` without attempt, `Attempt queued` with attempt 1; per item for a bulk), "Queueing failure is logged", "Started and completed job is logged", "Failed attempt with a retry is logged" (warn with `code` and `message`, then `Attempt queued` for the next attempt) and "Job failed for good is logged" (error with `code` and `message`). See them fail, then add the lines (design §7) and verify they pass
- [ ] 5.3 Write failing unit tests in `job-execution.impl.test.ts`, named after "Run of an attempt is logged" (`Attempt picked up`, `Handler started`, `Handler finished` with `durationMs` from the `Clock` mock, each with `jobId` and `attempt`), "Retried state report is logged" and "Dropped entry is logged" (existing lines, asserted with their fields). See them fail, then add the lines and verify they pass
- [ ] 5.4 Write a failing test in `job-execution-service-bootstrap.test.ts` that the logging module is built with the job log destination (source `job-execution-service`); wire `JobLogStreamDestination` into `LoggingModule.forRoot` in job-execution-service and close it on shutdown (job-service is wired in 3.6); verify the test and `npm test -w apps/job-execution-service` pass
- [ ] 5.5 Run the `test-case-reviewer` subagent on job-service unit tests (`src/infra/jobs/job-service.impl.test.ts`) and job-execution-service unit tests (`src/infra/execution/job-execution.impl.test.ts`, `src/infra/bootstrap/job-execution-service-bootstrap.test.ts`); add the missing cases it reports or note why they belong elsewhere

## 6. job-ui: Log card

Owns: `apps/job-ui/src/features/jobs/api/jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.test.ts`, `apps/job-ui/src/features/jobs/hooks/use-job-log.ts`, `apps/job-ui/src/features/jobs/hooks/use-job-log.test.tsx`, `apps/job-ui/src/features/jobs/details/job-log-card.tsx`, `apps/job-ui/src/features/jobs/details/job-log-card.test.tsx`, `apps/job-ui/src/features/jobs/details/job-page.tsx`, `apps/job-ui/src/features/jobs/details/job-page.test.tsx`, `apps/job-ui/src/features/jobs/testing/job-fixtures.ts`, `apps/job-ui/src/features/index.ts`, `apps/job-ui/src/features/transit-map/transit-report.tsx`, `apps/job-ui/src/features/transit-map/transit-report.test.tsx`, `apps/job-ui/test/e2e/jobs.spec.ts`, `apps/job-ui/test/e2e/transit.spec.ts` · Depends on: 1 · Parallel with: 2, 3, 4, 5

- [ ] 6.1 Write failing tests in `fetch-jobs-api.test.ts` (MSW): `logs` sends `after` and repeated `level` params only when given, parses the response, and throws `ApiError` with `LOG_STORE_UNAVAILABLE` on a 503. See them fail, then add `JobsApi.logs` and verify they pass
- [ ] 6.2 Write failing tests in `use-job-log.test.tsx` (fake timers): the first load, then polls with `after` = last cursor and appends; a full page is followed at once; a level change resets entries and cursor; a failed poll keeps the entries. See them fail, then implement `useJobLog` (design §11) and verify they pass
- [ ] 6.3 Write failing tests in `job-log-card.test.tsx`, named after "Log of a completed job", "Expand an entry's metadata", "New entry appears", "Show only errors", "Back to all", "Loading the log", "No entries yet", "No entries of the chosen level" and "Log unavailable". See them fail, then implement `JobLogCard` with strings from `en.ts` and verify they pass
- [ ] 6.4 Write failing tests that the job page shows the Log card below the Lifecycle (`job-page.test.tsx`, with "Log unavailable" leaving payload, details and Lifecycle shown) and "Log on the transit report" (`transit-report.test.tsx`); add the card to both pages; verify they pass
- [ ] 6.5 Add the job log to the job-ui Playwright tests (`jobs.spec.ts`, `transit.spec.ts`, mocked API): the card with rows and the level filter on a job page and on a transit report; verify `npm run test:e2e -w apps/job-ui` passes
- [ ] 6.6 Run the `test-case-reviewer` subagent on job-ui unit tests (`src/features/jobs/api/fetch-jobs-api.test.ts`, `src/features/jobs/hooks/use-job-log.test.tsx`, `src/features/jobs/details/job-log-card.test.tsx`, `src/features/jobs/details/job-page.test.tsx`, `src/features/transit-map/transit-report.test.tsx`) and job-ui e2e (`test/e2e/jobs.spec.ts`, `test/e2e/transit.spec.ts`); add the missing cases it reports or note why they belong elsewhere

## 7. Integration, docs and system e2e

Owns: `tests/system-e2e/jobs.spec.ts`, `tests/system-e2e/job-ui.spec.ts`, `tests/system-e2e/stack.setup.ts`, `DECISIONS.md`, `CLAUDE.md`, `README.md`, `openspec/config.yaml`, `docs/roadmap/05-reliability.md` · Depends on: 1–6 · Parallel with: none

- [ ] 7.1 Write system e2e tests (full compose stack): a submitted webhook job's log in the API holds the job-service steps and the worker's pickup with its instance id, and the job page shows them with the level filter working; "Log store down while a job runs" (`docker compose stop clickhouse`, a job completes, `start clickhouse`, its log appears); verify `npm run test:e2e` passes
- [ ] 7.2 `DECISIONS.md`: a "Job log" section (ClickHouse and why, "Postgres would suffice at this volume", owner job-service as a trade-off and a separate log service as the better design, pino reuse, Redis Stream with consumer group, single writer and its scaling path, no duplicates via `ReplacingMergeTree` + `FINAL`, loss cases: Redis down and stream trimming, retention TTL, the library choice with its numbers); fix the "Postgres ... logs" sentence; verify every decided point of `decisions.md` is covered
- [ ] 7.3 Update `CLAUDE.md` (architecture: ClickHouse holds job logs, Redis also carries the log stream; `LOG_STORE_UNAVAILABLE` in the error code list; compose services), `openspec/config.yaml` context, `README.md` (ClickHouse in the stack, the log route) and rename `job-log` to `job-log-service` in `docs/roadmap/05-reliability.md`; verify the documented commands run as written
- [ ] 7.4 Run the `test-case-reviewer` subagent on the system e2e (`tests/system-e2e/jobs.spec.ts`, `tests/system-e2e/job-ui.spec.ts`); add the missing cases it reports or note why they belong elsewhere
- [ ] 7.5 Run the full checks (`CHECK_CMDS` in `.claude/flow.conf`: typecheck, lint, test, format check) and `docker compose up --build --wait`; verify all pass

## Workflow follow-up

- Run the `change-verifier` subagent until it returns PASS.
- `/archive job-log-service` on the change branch, then merge into `master` with the user's approval.
