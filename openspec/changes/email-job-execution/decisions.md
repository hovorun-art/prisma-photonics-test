# Decisions: email-job-execution

## Decided

- The change is planned and built on its own branch `email-job-execution`, not on `master` (user)
- Carried over from `job-api`: queue entries carry only the job id under the entry id `<jobId>_<attempt>`; the worker reads the job through `GET /internal/v1/jobs/:id` and reports through `PATCH /internal/v1/jobs/:id` with `processing`, `completed` + result or `failed` + error; job-service decides retry or final failure and counts the attempt on start; two concurrent starts → one wins, the other gets 409 (user)
- Carried over from `project-scaffold`: job-execution-service has no database access and scales with `docker compose up --scale job-execution-service=N` plus in-process concurrency; its health check reports only itself (user)
- Email job (concept): simulates sending; waits 1–3 s and returns success with a mock message id (user, concept)
- If reporting to job-service fails, the worker retries the report a configured number of times with a short delay; if it still fails, it logs an error and drops the queue entry; the job stays `processing` until crash recovery (05-reliability) (user)
- BullMQ's own retries are off (one try per entry); job-service owns retries by queueing a new entry per attempt. Stalled detection stays on; a redelivered entry finds the job `processing` and is dropped; recovering such jobs is the crash-recovery change (user)
- On SIGTERM a worker stops taking new entries and waits for running jobs to finish and report, up to a configured grace period, then exits; unfinished jobs stay `processing` for crash recovery (user)
- One instance runs up to 5 jobs at once by default (configurable) (user)
- A system e2e on the full compose stack submits an email job to job-service and polls it until `completed` with a message id, proving API → Postgres → queue → execution → Postgres (user)
- From now on every change is planned, built and archived on its own branch; CLAUDE.md and the flow skills say so (user)
- Before starting a job the worker reads it; when it is no longer pending (started by another worker, finished or deleted), the entry is dropped without running anything; a start answered with 409 or 404 is dropped and logged at info level, not as an error (user confirmed assumption)
- The job read from job-service is validated against the shared `Job` schema (mismatch → reported `failed` with code `INVALID_PAYLOAD`); a type without a handler → `failed` with `UNSUPPORTED_JOB_TYPE`; a handler error → `failed` with `{ code, message }` (unknown errors as `HANDLER_ERROR`); job-service then decides on retry (user confirmed assumption)
- The mock message id is a random UUID; the wait is a uniform random duration within the configured 1–3 s range; both come through the kernel `Random` and `Sleeper` ports (user confirmed assumption)
- Handlers live in a `notifications` domain module behind a `JobHandler` interface keyed by job type; every job log line carries `jobId`, the attempt and the worker instance id; new settings (job-service URL, service token, concurrency, email wait range, report retries and delay, shutdown grace) have their defaults only in the config parser (user confirmed assumption)

## Assumed

- [x] Before starting a job, the worker reads it; when the job is no longer pending (already started by another worker, finished or deleted), the worker drops the queue entry without running anything - the job's state in Postgres is the source of truth
- [x] A start answered with 409 (another worker won) or 404 (job deleted) is not an error: the entry is dropped and logged at info level - expected under concurrency
- [x] The job read from job-service is validated against the shared `Job` schema; a job whose payload does not match fails with an error code `INVALID_PAYLOAD` reported through the internal update - input is validated at the edge
- [x] A job type this worker has no handler for is reported as failed with error code `UNSUPPORTED_JOB_TYPE` - later types add handlers
- [x] An error thrown by a handler is reported as `failed` with `{ code, message }` (unknown errors as `HANDLER_ERROR`), so job-service decides on retry - one path for all failures
- [x] The mock message id is a random UUID; the wait time is a uniform random duration within the configured range (1–3 s), both through the kernel `Random` and `Sleeper` ports - deterministic tests
- [x] Every log line about a job carries `jobId`, the attempt and the worker instance id - CLAUDE.md logging rule
- [x] Handlers live in a `notifications` domain module behind a `JobHandler` interface keyed by job type - CLAUDE.md module layout
- [x] New settings: job-service base URL, the service token (same variable as job-service), in-process concurrency per instance, the email wait range; all in config with defaults in the parser only - same pattern as job-service

## Open questions

- [x] Reporting to job-service fails (job-service down or times out) after the job ran: what does the worker do?
- [x] BullMQ's own retries and stalled-job redelivery: switch them off (job-service owns retries; crash recovery comes later) or keep BullMQ defaults?
- [x] On shutdown (SIGTERM), does the worker wait for running jobs to finish, and for how long?
- [x] How many jobs does one instance run at once by default?
- [x] Should the system e2e (full compose stack) cover a submitted email job reaching `completed`?
- [x] Module layout, log fields and settings (unticked by mistake, accepted): handlers in `notifications` behind `JobHandler`; job log lines with jobId, attempt and instance id; settings job-service URL, service token, concurrency, email wait range, report retries, shutdown grace with parser-only defaults. What should change?
