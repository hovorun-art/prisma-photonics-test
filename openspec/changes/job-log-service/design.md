# Design

## Context

See proposal.md for why; the behaviour is in `specs/job-log/spec.md` and `specs/job-ui/spec.md`.

What exists today:
- Both backends log through `LoggingModule.forRoot` in `packages/service-kit`
  (`src/app/logging/logging.module.ts`, nestjs-pino). It already takes a `destination`
  (`LogDestination`: one JSON line per `write`) that the bootstrap tests use to collect lines.
  Redaction (`LogPolicy.redactedPaths`) is applied by pino before a line reaches any destination.
- Job-related lines already carry `jobId` and, in execution, `attempt` (`fields` in
  `job-execution.impl.ts`) and `instanceId` (the logger's `base`). job-service's lines carry `jobId`
  and `attempt` where they exist (`job-service.impl.ts`, `bullmq-job-queue.ts`).
- `packages/service-kit` has a Redis module (`RedisConnection`, ioredis) used by both backends.
- job-service owns Postgres (Prisma) and the error filter with its `HTTP_STATUS_BY_ERROR_CODE` table;
  `ERROR_CODES` live in `packages/kernel/src/domain/error-codes.ts`.
- job-ui calls job-service through `JobsApi` (`features/jobs/api/`), with strings in `src/locales/en.ts`.

## Goals / Non-Goals

**Goals:**
- One logging call per step: pino lines are the source of the job log (decisions.md).
- A write path that cannot slow down or fail a job, and a store path that loses nothing while Redis
  keeps the entries and stores nothing twice.
- A read path that lets a client poll for only the newer entries without missing any.

**Non-Goals:**
- A separate log service (recorded as the better design in `DECISIONS.md`).
- Full-text search, log aggregation across jobs, a log of non-job events.
- Deleting log entries when a job is deleted (left to retention).
- ClickHouse replication or clustering: one node in compose.

## Decisions

### 1. Data flow

```
 job-service / job-execution-service
   logger.log/warn/error({ jobId, attempt, ... }, msg)
        │ pino (redaction applied)
        ├──► stdout (unchanged)
        └──► JobLogStreamDestination  (service-kit; info+ and `jobId` only)
               │ XADD job-log MAXLEN ~ <max> *   (fire and forget)
               ▼
           Redis Stream `job-log`  ── consumer group `job-log-writer`
               │ XREADGROUP COUNT <batch> BLOCK <interval>
               ▼
           JobLogWriter (job-service, one active at a time)
               │ INSERT batch ──► ClickHouse `job_log`   then XACK
               ▼
 GET /v1/jobs/:id/logs ──► JobLogService ──► JobRepository (exists?) + JobLogStore (query)
```

### 2. Producer: a pino destination in service-kit

`LoggingModule.forRoot` gets an optional `jobLog: LogDestination`. When set, pino writes through the
built-in `pino.multistream` to the main destination (stdout, `destination`, or pino-pretty as a
stream in development) and to `jobLog` at level `info`. Because the lines come from pino, redaction
already applied; nothing is logged twice in code.

`JobLogStreamDestination` (`packages/service-kit/src/infra/job-log/`, implements `LogDestination`):
- `write(line)` is synchronous for pino: it parses the line, ignores it without `jobId`, maps the
  level (30 → `info`, 40 → `warning`, 50/60 → `error`), drops `err.stack`, and builds the stream
  message: `id` (from the kernel `Random` port), `jobId`, `attempt?`, `level`, `message` (`msg`),
  `metadata` (the remaining fields minus pino's own `level`, `time`, `pid`, `hostname`, `msg`,
  `jobId`, `attempt`, `instanceId`), `ts` (pino `time`, ms), `source` (`p.source`) and
  `instanceId?`.
- It sends `XADD job-log MAXLEN ~ <max> * data <json>` without awaiting it, on its own ioredis
  connection with `enableOfflineQueue: false` and `maxRetriesPerRequest: 0`, so a Redis outage fails
  at once instead of queueing in memory.
- On a send failure it writes one warning line to the main destination with `droppedJobLogEntry:
  true` and the `jobId`. The destination ignores lines with that marker, so a dropped entry never
  produces another entry (no feedback loop).
- It implements `Closable`; shutdown closes its connection after pino's last line.

Alternatives: an explicit `JobLog.append()` port called next to each `logger.*` call (rejected by
the user: "reuse existing logs"); a pino transport in a worker thread (`pino-abstract-transport`,
a new library, harder to inject ports into and to test).

### 3. Transport: a Redis Stream with a consumer group

One stream `job-log` and a consumer group `job-log-writer`, created by the writer with
`XGROUP CREATE ... $ MKSTREAM` (BUSYGROUP ignored). `MAXLEN ~` keeps Redis memory bounded at the
configured length; entries trimmed before they are read are lost (decided).

The stream id Redis assigns at `XADD` is monotonic for the one stream, so it is the log's order key
and its cursor (section 5). Alternative: BullMQ (rejected by the user: a job queue, heavier per
entry, no batch reads).

### 4. Writer: batch, store, then confirm

`JobLogWriter` (`apps/job-service/src/domain/job-log/`, implemented by `JobLogWriterImpl` in
`infra/job-log/`) runs a loop started by a lifecycle hook in `app/job-log/`:
1. On start, read this consumer's pending entries first (`XREADGROUP ... 0`), then new ones (`>`).
2. Collect up to the configured batch size, waiting at most the configured flush interval after
   the first entry (`XREADGROUP COUNT <batch> BLOCK <interval>`, then top up without blocking).
3. Validate each message with the contract schema (the edge); a malformed message is logged and
   acknowledged, never retried forever.
4. Insert the batch into ClickHouse in one `INSERT ... FORMAT JSONEachRow`; on failure wait with
   capped exponential backoff (`Sleeper` port, configured min/max) and retry the same batch; the
   loop reads nothing new until it succeeds, so entries wait in Redis while ClickHouse is down.
5. `XACK` the batch only after the insert succeeded.
6. On shutdown, finish or abandon the current batch (unacknowledged entries are read again).

One writer at a time: the loop holds a Redis lease (`SET job-log-writer-lease <instance> NX PX`,
renewed each round). With several job-service instances, the others wait. This keeps batches
stored in stream order, which the cursor relies on (section 5). Alternative: several concurrent
consumers (more throughput, but a later batch could be stored before an earlier one and an
incremental reader would skip the earlier one); the single writer is the documented limit, and the
scaling path is several streams sharded by job id, each with its own writer.

### 5. Store: ClickHouse table

```sql
CREATE TABLE IF NOT EXISTS job_log (
  id          UUID,
  job_id      UUID,
  seq_ms      UInt64,            -- stream id, millisecond part
  seq_n       UInt32,            -- stream id, sequence part
  ts          DateTime64(3, 'UTC'),
  attempt     Nullable(UInt32),
  level       Enum8('info' = 1, 'warning' = 2, 'error' = 3),
  message     String,
  metadata    String,            -- JSON text
  source      LowCardinality(String),
  instance_id Nullable(String)
)
ENGINE = ReplacingMergeTree
ORDER BY (job_id, seq_ms, seq_n, id)
TTL toDateTime(ts) + INTERVAL <retention days> DAY
```

- `ORDER BY (job_id, seq...)` makes "one job's entries in order" a primary-key range read.
- No duplicates (decided): a batch inserted again after a writer crash has the same rows (same `id`
  and stream id), and `ReplacingMergeTree` keeps one row per sorting key. Reads use `FINAL`, which
  removes duplicates not merged yet; with the read limited to one job's key range its cost is small.
  Alternative: `insert_deduplication_token` per batch (needs `non_replicated_deduplication_window`
  on a non-replicated table and fails if a retried batch differs, e.g. after trimming); kept as a
  possible addition, not relied on.
- Retention: the `TTL` clause from config (`JOB_LOG_RETENTION_DAYS`).
- Schema: job-service applies it at startup (`CREATE TABLE IF NOT EXISTS`, then `ALTER TABLE ...
  MODIFY TTL` with the configured days) through a `JobLogSchema` port called from a module init
  hook, so no second migration tool is needed and e2e files that do not test the log override the
  port (and `JobLogStore`, `JobLogWriter`) with mocks instead of starting ClickHouse. Alternatives:
  a bootstrap setup step (every e2e file would need ClickHouse, since they apply the real
  `JOB_SERVICE_SETUP_STEPS`); a ClickHouse migration tool in the `migrate` image (a new library for
  one table).
- Client: `@clickhouse/client` (decided), behind the `JobLogStore` port
  (`ClickHouseJobLogStore`). Connection errors and timeouts become `LogStoreUnavailableError`.

### 6. Read API

`GET /v1/jobs/:id/logs?limit=&after=&level=&level=` in `app/job-log/job-log.controller.ts`, calling
the `JobLogService` port:
- Parse the query with the contract schema (`QueryJobLogRequest`): `limit` positive integer up to
  the configured max (default from config), `level` repeated values of `JobLogLevel`, `after` a
  cursor.
- Cursor: base64url of the stream id `"<ms>-<n>"`; the schema decodes and checks it, so a value the
  route did not issue is `VALIDATION_FAILED` on `after`.
- Check the job exists through `JobRepository` (404 `JOB_NOT_FOUND` otherwise, deleted jobs
  included), then query `JobLogStore`:
  `SELECT ... FROM job_log FINAL WHERE job_id = {id} AND (seq_ms, seq_n) > ({ms}, {n})
  [AND level IN {levels}] ORDER BY seq_ms, seq_n LIMIT {limit}`.
- `nextCursor`: the last returned entry's stream id, the given `after` when nothing was returned,
  `null` when neither exists.
- Response `{ items: JobLogEntry[], nextCursor: string | null }`; `ts` as ISO string with
  milliseconds like the other job timestamps; `metadata` parsed back to an object.
- New code `LOG_STORE_UNAVAILABLE` in kernel `ERROR_CODES`, 503 in the filter's table, thrown by
  the store adapter as `LogStoreUnavailableError` (job-service `domain/job-log/errors/`).
- Swagger from the Zod schemas like the other routes.

Entries are shown oldest first by stream order, which is the order they reached Redis; their `ts` is
the producer's clock. For entries from different processes this may differ by clock skew, which is
fine for a step log.

### 7. Logged steps

Existing lines already cover some steps. Lines to add or adjust (messages are the pino `msg`):
- job-service: `Job submitted` (no attempt) on create and per bulk item; `Attempt queued`
  (attempt) after enqueue; `Job stays pending: it could not be queued` (warn, exists);
  `Attempt started` on the accepted `processing` report; `Job completed`; `Attempt failed, retry
  queued` (warn, `code`, `message`); `Job failed for good` (error, `code`, `message`).
- job-execution-service: `Attempt picked up` (with `instanceId` from the base); `Handler started`;
  `Handler finished` (`durationMs`, from the `Clock` port); `job-service unavailable, retrying`
  (warn, exists); `Skipped: job is no longer pending` (info, exists).
Levels: info for normal steps, warning for a recoverable problem, error when a job is lost for good.

### 8. Contracts

`packages/contracts/src/jobs/job-log.ts`: `JOB_LOG_LEVELS`, `JobLogLevel`, `JobLogEntry`,
`JobLogStreamMessage` (what the destination writes and the writer validates), `JobLogCursor`,
`QueryJobLogRequest`, `QueryJobLogResponse`. Limits come from job-service config, not the contract,
like the jobs list.

### 9. Configuration (`.env.example`, config parsers)

| Variable | Default | Used by |
|---|---|---|
| `CLICKHOUSE_URL` (credentials and database in the URL, like `DATABASE_URL`) | `http://jobqueue:jobqueue@localhost:8123/jobqueue` (compose: host `clickhouse`) | job-service |
| `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DB`, `CLICKHOUSE_HTTP_PORT` | `jobqueue` / 8123 | the `clickhouse` container (compose) |
| `JOB_LOG_WRITER_LEASE_MS` | 60000 (above the retry maximum) | job-service |
| `JOB_LOG_RETENTION_DAYS` | 30 | job-service |
| `JOB_LOG_QUERY_DEFAULT_LIMIT` / `JOB_LOG_QUERY_MAX_LIMIT` | 100 / 1000 | job-service |
| `JOB_LOG_BATCH_SIZE` / `JOB_LOG_FLUSH_INTERVAL_MS` | 1000 / 1000 | job-service |
| `JOB_LOG_STORE_RETRY_DELAY_MS` / `..._MAX_DELAY_MS` | 500 / 30000 | job-service |
| `JOB_LOG_STREAM_MAX_LENGTH` | 100000 | both backends (base config) |

### 10. Compose and dev

A `clickhouse` service (`clickhouse/clickhouse-server`, current stable tag checked at apply time)
with a volume, the user/password/db from env, and a healthcheck on `/ping`; job-service depends on
it being healthy. `npm run dev` starts it with Postgres and Redis.

### 11. job-ui

- `JobsApi.logs({ id, level?, after? })` → `QueryJobLogResponse`.
- `useJobLog({ id, level })`: keeps the entries shown and the last cursor; polls at the configured
  interval with `after = cursor` and appends; when an answer is a full page it asks again at once,
  so a long log loads completely. Changing the level resets the entries and the cursor. A failed
  poll after data was shown keeps the entries (as the job page does); a `LOG_STORE_UNAVAILABLE`
  answer with nothing shown yet shows "Log unavailable".
- `JobLogCard` (`features/jobs/details/job-log-card.tsx`): level buttons (All, Info, Warning,
  Error), rows (time, level badge, attempt, message, expandable metadata as JSON), skeleton rows,
  the empty texts and "Log unavailable"; strings in `locales/en.ts`. Used on the job page below the
  Lifecycle and at the bottom of the transit report (through the jobs feature's public `index.ts`).

### 12. Tests per level

- contracts: schema unit tests (cursor round trip, levels, limits).
- service-kit: `JobLogStreamDestination` unit tests (filtering, mapping, stack drop, no throw on
  send failure, no loop on the drop warning) with a `mockDeep` Redis port; `LoggingModule` test for
  the multistream; integration test against real Redis (`XADD` with `MAXLEN ~`).
- job-service: `ClickHouseJobLogStore` integration test (`@testcontainers/clickhouse`: order,
  level filter, cursor, duplicates removed, TTL via `OPTIMIZE ... FINAL`, unavailable store);
  Redis stream adapter integration test (group creation, pending re-read, ack, lease);
  `JobLogWriterImpl` unit tests with fake timers (batch size, flush interval, ack only after insert,
  retry with backoff, malformed message); `JobLogServiceImpl` unit tests; new per-app e2e file
  `job-log.e2e.test.ts` (one spec area): ClickHouse is job-service's own store and is real there,
  like Postgres (a fresh container per file, the schema applied by the app, emptied before each
  test); `JobLogWriter` and the Redis stream are mocked at their ports and entries are seeded
  through the app's own `JobLogStore` (`app.get(JOB_LOG_STORE)`). The other e2e files override
  `JobLogSchema`, `JobLogStore` and `JobLogWriter` with `mockDeep` so they need no ClickHouse.
- job-execution-service: unit tests of the added lines in `job-execution.impl.test.ts`.
- job-ui: `job-log-card.test.tsx` and the job page and transit report tests.
- system e2e: a job's log in the UI after it runs, the level filter, and a job that completes while
  ClickHouse is stopped and whose log appears after it starts again.

## Risks / Trade-offs

- [Single writer limits throughput] → Batches of 1000 into ClickHouse handle far more than this
  stack produces; sharding the stream by job id is the documented next step.
- [Entries lost while Redis is down or when the stream is trimmed] → Decided and documented; the
  drop is visible as a pino warning; the job itself is unaffected.
- [Job-related pino lines become public via the API] → Only info and above, after redaction, without
  stacks; a review of what lines carry `jobId` is part of the tasks.
- [`FINAL` on reads] → Limited to one job's primary-key range; a job has tens of entries.
- [Producer clock skew in `ts`] → Order uses the Redis stream id, not `ts`.
- [One more container (~0.5–1 GB RAM)] → Acceptable for the demo; stated in `DECISIONS.md` along
  with "Postgres would suffice at this volume".
- [Owner is job-service, not a log service] → Recorded trade-off; the job log lives in its own
  feature folders behind `JobLogStore`, `JobLogService` and `JobLogWriter`, so it can move to its own
  service with its own API without changing the producers.

## Migration Plan

New table and new stream; nothing existing changes shape. Deploy: start ClickHouse, then job-service
creates the table at startup. Rollback: remove the destination from `LoggingModule` (lines go to
stdout only) and the route; the stream and table can be dropped.
