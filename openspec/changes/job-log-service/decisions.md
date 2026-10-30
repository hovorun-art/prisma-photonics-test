# Decisions: job-log-service

## Decided

- Job log entries are stored in ClickHouse, not Postgres, to show a store suited to high log volume (append-only, ordered by job and time, removed by age); `DECISIONS.md` says plainly that Postgres would suffice at this task's volume. (user)
- job-service owns the job log. `DECISIONS.md` records this as a trade-off to save scaffolding a new service; a separate log service with its own API is the better design. (user)
- Log entries are sent asynchronously through Redis and written to ClickHouse in batches; writing a log entry never blocks or fails a job, and an entry may appear shortly after its step. (user)
- job-ui reads a job's log through job-service's API. (user)
- The change is named `job-log-service` after its branch; the roadmap item `job-log` is renamed to it. (user)
- ClickHouse client: `@clickhouse/client` (official; ~4.55M weekly downloads, v1.24.1 of 2026-10-09, bundled TypeScript types, CJS and ESM); integration tests use `@testcontainers/clickhouse` (~349k weekly, v12.2.1). (user)
- Transport: a Redis Stream; producers append entries, the writer reads them through a consumer group in batches, inserts the batch into ClickHouse and then confirms it, so entries a crashed writer did not confirm are read again. Uses the existing ioredis, no new library. (user)
- Logged steps: job-service logs submitted, queued, queueing failed, attempt N started, completed, attempt N failed with the error and the retry scheduled, failed for good; job-execution-service logs attempt picked up by worker X, handler started, handler finished with its duration, state report retried, entry dropped because the job was not pending. (user)
- Retention: configurable, 30 days by default; older entries are removed by the store. (user)
- Deleting a job leaves its log entries to retention; the log route answers 404 `JOB_NOT_FOUND` once the job is gone, so they can no longer be read. (user)
- `GET /v1/jobs/:id/logs` answers `{ items, nextCursor }`: up to `limit` entries (configured default and maximum) after the `after` cursor, oldest first; the UI fetches only new entries on each poll. (user)
- Level filter in API and UI: the route accepts repeated `level` parameters; the log offers All / Info / Warning / Error buttons. (user)
- job-ui shows a "Log" card on the job page below the Lifecycle timeline and at the bottom of the completed transit report page; each row shows time, level badge, attempt, message and expandable metadata; new entries appear as they arrive. (user)
- ClickHouse down: entries wait in the Redis Stream and the writer retries with backoff. The log route answers HTTP 503 with a new error code `LOG_STORE_UNAVAILABLE`; the job page keeps working and only its Log card shows "Log unavailable". (user)
- Redis down while sending an entry: the step goes on, the entry is dropped and a pino warning with the job id records it; the stream has a configured maximum length so Redis memory stays bounded. (user)
- No duplicate entries: each entry carries its own id, and a batch read again after a writer crash is deduplicated, so each entry appears once. (user)
- Writer batching: writes when 1000 entries are read or 1 s after the first unwritten one, whichever comes first; both configurable. (user)
- Log route `limit`: 100 by default, 1000 at most; both configurable. (user)
- Log stream maximum length: 100,000 entries, trimmed approximately; configurable. Entries trimmed before the writer reads them are lost. (user)
- Each entry has an id, the job id, the attempt it belongs to (none for steps outside an attempt, such as submission), a level (`info`, `warning`, `error`), a message, a metadata object and a timestamp with milliseconds. (user confirmed assumption)
- Each entry names its source: `job-service`, or `job-execution-service` with the worker instance id. (user confirmed assumption)
- A job id that is not a UUID answers HTTP 400 `VALIDATION_FAILED` and an unknown or deleted job HTTP 404 `JOB_NOT_FOUND` on the log route, as on `GET /v1/jobs/:id`; the route appears in the OpenAPI docs; job-ui polls the log at the job page's polling interval. (user confirmed assumption)
- Reuse the existing logs: job log entries come from the services' existing pino log calls, not from a second logging API. Every pino line at info or above that carries `jobId` becomes an entry, sent to the Redis Stream through pino's destination (built-in `pino.multistream`: standard output and the stream, no new library). Level from pino (`warn` becomes `warning`), message from `msg`, attempt and instance id from their fields, the remaining fields as metadata after the existing redaction, error stacks dropped. The decided steps get pino lines where they are missing. Messages therefore stay the existing English pino messages. (user)
- Empty Log card: "No log entries yet" with All chosen, "No info entries" / "No warning entries" / "No error entries" with a level chosen; skeleton rows while the first log request loads. (user)

## Assumed

- [x] Each entry has an id, the job id, the attempt it belongs to (none for steps outside an attempt, such as submission), a level (`info`, `warning`, `error`), a message, a metadata object and a timestamp with milliseconds - the task's data model plus what is needed to group entries by attempt.
- [x] Each entry names its source: `job-service`, or `job-execution-service` with the worker instance id - so a reader can tell which worker ran an attempt.
- [x] The existing pino logs stay as they are; the job log is an addition, not a replacement - pino serves operators, the job log serves API clients and the UI. (rejected: replaced by "reuse the existing logs", see Decided)
- [x] Log messages are fixed English sentences built in the backend (e.g. "Attempt 2 started"); job-ui shows them as they come - the backend has no translation files, and the UI shows data, not its own strings. (rejected: replaced by "reuse the existing logs", see Decided)
- [x] A job id that is not a UUID answers HTTP 400 `VALIDATION_FAILED` and an unknown or deleted job answers HTTP 404 `JOB_NOT_FOUND` on the log route, as on `GET /v1/jobs/:id` - the same rules as the existing job routes.
- [x] The log route appears in job-service's OpenAPI documentation - as every public route does.
- [x] The log in job-ui is polled at the same configured polling interval as the job page - consistent with the rest of the page.

## Open questions

- [x] Which ClickHouse client library?
- [x] Which Redis mechanism carries log entries from producers to the batch writer?
- [x] Which steps get log entries, and which service writes each?
- [x] How long are entries kept (retention)?
- [x] What happens to a job's log entries when the job is deleted?
- [x] How does the log route page through entries, and in what order?
- [x] Can the log be filtered by level (API, UI)?
- [x] Where and how does job-ui show the log (job page, transit report page)?
- [x] What happens when ClickHouse is down (writing and reading)?
- [x] What happens when Redis is down while a step tries to send an entry?
- [x] Can an entry appear twice after a crash between writing a batch and confirming it?
- [x] Batch size and flush interval of the writer.
- [x] Default and maximum `limit` of the log route.
- [x] Maximum length of the log stream.
- [x] What does the Log card show when it has no entries?
