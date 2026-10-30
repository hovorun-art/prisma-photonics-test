# Proposal

## Why

The task recommends a job log (job reference, level, message, metadata, timestamp), and the roadmap's
`job-log` item asks for every lifecycle step and attempt to be logged and shown in the job details.
Today a job only shows its current state and timestamps; when a job retried or failed there is no
record of what happened in each attempt. Logs are a different kind of data from job state: written
far more often than read, append-only, read per job in time order and removed by age. This change
stores them in a store made for that kind of data, so the design shows how logging scales beyond
this task's volume.

## What Changes

- A job log: each step of a job's lifecycle and each attempt produces log entries with the job
  reference, a level (info, warning, error), a message, metadata and a timestamp.
- Log entries are stored in ClickHouse, not in Postgres: an append-only store ordered by job and
  time, with entries removed after a configured retention period.
- Entries reuse the services' existing structured logs: every job-related log line also becomes a
  job log entry, so nothing is logged twice.
- Writing a log entry never blocks or fails a job: entries are sent through Redis and written to
  ClickHouse in batches, so an entry may appear shortly after the step it records.
- job-service owns the job log and offers a public API to read a job's log entries; job-ui reads the
  log through it. A separate log service with its own API would be the better design; keeping it in
  job-service saves scaffolding a new service and is recorded as a trade-off in `DECISIONS.md`.
- The job page in job-ui shows the job's log.
- `docker-compose.yml` gains a ClickHouse service; `DECISIONS.md` gets the log store choice and
  replaces its statement that Postgres holds the logs.

## Capabilities

### New Capabilities
- `job-log`: which log entries a job gets, what an entry contains, how API clients read a job's
  log, and how long entries are kept.

### Modified Capabilities
- `job-ui`: the job page shows the job's log.

## Impact

- `apps/job-service`: log reading API, log ingestion from Redis into ClickHouse, log entries for
  the steps it decides (submission, queueing, start, retry, completion, failure).
- `apps/job-execution-service`: sends log entries for the steps of an attempt it runs.
- `apps/job-ui`: a log section on the job page.
- `packages/contracts`: the log entry schema and the log query response.
- New dependencies: a ClickHouse client library (chosen by the user), a ClickHouse container in
  compose and Testcontainers for its integration tests.
- `DECISIONS.md`, `CLAUDE.md` (architecture: the log store) and `docs/roadmap/05-reliability.md`
  (the `job-log` item becomes `job-log-service`).
