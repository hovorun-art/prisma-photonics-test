# Design

## Context

job-service (from `job-api`) stores jobs, queues `{ jobId }` under BullMQ id `<jobId>_<attempt>` on
`JOB_QUEUE_NAME`, and offers `GET`/`PATCH /internal/v1/jobs/:id` behind the service token, with the
lifecycle rules (start only from pending, retry or final failure) inside job-service. Today
job-execution-service only connects to Redis and answers its own health check. Motivation:
proposal.md; behaviour: `specs/job-execution`, `specs/email-job`.

## Goals / Non-Goals

**Goals:**
- Run queued jobs end to end without the worker owning any job state: every decision about a job's
  state is job-service's, the worker only reads and reports.
- BullMQ only behind a consumer port; job-service only behind a client port, so either side can be
  replaced or moved without touching the execution logic.
- Handlers per job type behind one interface, so webhook, flight-transit and batch plug in later.

**Non-Goals:**
- Recovering jobs stuck in `processing` (worker crash, report given up): `crash-recovery`.
- Backoff between attempts, priority, scheduling: their own changes.

## Decisions

### Flow of one entry (`JobExecution.execute`)

1. Parse the entry: data through `JobQueueMessage`, job id and attempt from the entry id through
   the shared codec `JobQueueEntryId` in `packages/contracts` (job-service encodes with it); the
   attempt is for logs only (job-service decides the real attempt).
2. `JobRepository.get` (retried like reports while job-service is unavailable) → not found: drop
   (info). Response validated with `Job`; a mismatch is started like any job (step 4) and then
   reported `failed` with `INVALID_PAYLOAD`: job-service accepts a failure only for a `processing`
   job, so failing it straight from `pending` would be refused with 409.
3. Status not `pending`: drop (info), no report.
4. `update(processing)` → 409/404: drop (info). Other failures: report retry (below), then give up.
5. Find the handler for `job.type` → none: report `failed` `UNSUPPORTED_JOB_TYPE`.
6. Run the handler → result: report `completed` with it; throws: report `failed` with
   `{ code, message }` of a `DomainError`, else `HANDLER_ERROR` and the message.
7. Every call to job-service goes through `pRetry` from the `p-retry` library (decided, from npm
   usage data): `retries` = the configured retries, `minTimeout` = the retry delay, `factor` 2,
   `maxTimeout` = the max retry delay, `randomize: true`, `signal` = the abort signal of
   `abort()`; `shouldRetry` allows only `JobServiceUnavailableError`. After the last failed try:
   log error and drop.

`execute` never throws: every outcome ends in a report or a logged drop, so the BullMQ entry always
completes and BullMQ never retries it (decided: BullMQ retries off). Entries are added by job-service
with BullMQ's default of one attempt, so nothing needs changing on the producer side.

### Ports (`apps/job-execution-service/src/domain/`)

- `jobs/job-repository.ts`: `JobRepository` (decided name: to the worker it is where jobs are
  read and saved) with `get({ id, signal })` and
  `update({ id, update, signal })`, plain contract types (`Job`, `UpdateJobRequest`); the signal is
  aborted when the grace period is over. Errors: `JobNotFoundError` (`JOB_NOT_FOUND`) and
  `JobStatusConflictError` (`JOB_STATUS_CONFLICT`), both shared with job-service from
  `packages/kernel` (the conflict error has an optional `status`), `JobServiceUnavailableError` (new code
  `JOB_SERVICE_UNAVAILABLE`: network error, timeout or 5xx; the only retried one), and
  `InvalidJobError` (`VALIDATION_FAILED`: a job that fails the shared `Job` schema, or any other 4xx,
  i.e. job-service rejecting a report as invalid; reported as `INVALID_PAYLOAD` when reading, given up
  and logged when reporting).
- `queue/job-queue-consumer.ts`: `JobQueueConsumer` with `start({ execute })` and `close()`
  (`Closable`); `execute` receives `{ jobId, attempt }`.
- `execution/job-execution.ts`: `JobExecution.execute({ jobId, attempt })` and `abort()`, which
  aborts every running handler; aborted jobs report nothing more (used when the shutdown grace period
  is over).
- `notifications/job-handler.ts`: `JobHandler.run({ job, signal })` → `{ result }`; the handlers are a
  record keyed by job type (`JobHandlers`, token `JOB_HANDLERS`), so a type without a handler is a
  missing key. (A list searched by a `type` field was the first plan; with a single job type the
  compiler rejects the comparison as always true.)
- Error codes reported in `JobError.code` (`INVALID_PAYLOAD`, `UNSUPPORTED_JOB_TYPE`,
  `HANDLER_ERROR`) are constants in `domain/execution/job-error-codes.ts`: they are codes inside a
  job's stored error, not API error codes, so they do not go into `ERROR_CODES`.

### Implementations (`infra/`)

- `jobs/http-job-repository.ts` (`HttpJobRepository`): `fetch` to `JOB_SERVICE_URL` +
  `INTERNAL_JOBS_ROUTE`, `Authorization: Bearer <token>`, a request timeout, a read parsed with the
  shared `Job` schema; the job in the answer to an accepted report (2xx) is passed through
  unchecked, so a corrupted payload cannot hide a step job-service already took (decisions.md);
  status → error mapping as above.
- `queue/bullmq-job-queue-consumer.ts` (`BullMqJobQueueConsumer`): a BullMQ `Worker` with the
  configured `concurrency`, its own connection from `REDIS_URL`, `autorun: false` (started by
  `start`), finished entries removed after a bounded count so Redis does not grow. `close()` calls
  `worker.close()`, which stops taking entries and waits for running ones.
- `execution/job-execution.impl.ts` (`JobExecutionImpl`): the flow above; deps `jobs` (`JobRepository`),
  `handlers`, `logger`; params `reportRetries`, `reportRetryDelayMs`, `reportRetryMaxDelayMs`. The
  jitter comes from the library's own randomness, so unit tests drive the waits with Vitest's fake
  timers rather than a `Random` port.
- `notifications/email-job-handler.ts` (`EmailJobHandler`): `random` and `sleeper` ports; waits
  `random.int(minMs..maxMs)` and returns `{ messageId: random.uuid() }`; the kernel `Random`
  port gained `uuid()` (decided: the id comes through `Random`).

### Shutdown

`ExecutionModule.beforeApplicationShutdown` closes the consumer (BullMQ stops taking entries and
waits for running ones) and races it against the configured grace period. When the grace period wins,
it calls `JobExecution.abort()`: handlers get an aborted signal (the email wait honours it through
`Sleeper`), the entries end without a report, the consumer closes and the process exits; unfinished
jobs stay `processing`. (Without the abort, a still sleeping handler would keep the process alive and
report after the grace period.) Compose gets a `stop_grace_period` a little above the grace period so Docker does not
kill the process first.

### Config (parser defaults only; `.env.example` lists them commented out)

`JOB_SERVICE_URL` (required), `INTERNAL_SERVICE_TOKEN` (required, same variable as job-service),
`JOB_EXECUTION_CONCURRENCY=5`, `EMAIL_SEND_MIN_MS=1000`, `EMAIL_SEND_MAX_MS=3000` (min ≤ max),
`JOB_REPORT_RETRIES=3`, `JOB_REPORT_RETRY_DELAY_MS=500`, `JOB_REPORT_RETRY_MAX_DELAY_MS=5000`
(delay ≤ max), `JOB_SERVICE_TIMEOUT_MS=5000`,
`JOB_EXECUTION_SHUTDOWN_GRACE_MS=10000`. Compose: job-execution-service gets `JOB_SERVICE_URL`,
the token, `depends_on: job-service (healthy)` and `stop_grace_period: 15s`.

### Logging

Every log call of `JobExecutionImpl` passes `{ jobId, attempt }` as its first argument; the instance id is
already in every line (`LoggingModule` base). Skips at info, given-up reports at error.

### Tests

- Unit: `JobExecutionImpl` (every branch, `mockDeep` ports, `...Once` stubs), `EmailJobHandler`,
  config parser.
- Integration: `HttpJobRepository` against a stub HTTP server answering contract-valid bodies (status
  mapping, token header, timeout); `BullMqJobQueueConsumer` against Redis (single take per entry,
  concurrency cap, close waits for running entries).
- Per-app e2e: the real job-execution-service with its own Redis and a simulated job-service (stub
  HTTP server that records reports): completion, skip, deleted, lost start, invalid payload, report
  retry and give-up, shutdown drain, log fields.
- System e2e: submit an email job on the compose stack and poll until `completed` with a message id.

### Module boundaries for the task groups

1. Shared foundation: kernel code `JOB_SERVICE_UNAVAILABLE`, `domain/` ports and errors, config.
2. `notifications`: `EmailJobHandler`.
3. `jobs`: `HttpJobRepository`.
4. `queue`: `BullMqJobQueueConsumer`.
5. `execution`: `JobExecutionImpl`.
6. Integration: Nest wiring, shutdown step, compose, e2e, system e2e, docs.

## Risks / Trade-offs

- [A report given up or a worker crash leaves a job `processing`] → decided; `crash-recovery`
  handles it. Logged at error level with the job id so it is visible.
- [Read-then-start costs one extra call per job] → keeps the worker from starting jobs that were
  finished or deleted; job-service's conditional write is still what prevents duplicates.
- [BullMQ stalled detection may redeliver an entry of a crashed worker] → the redelivered entry
  finds the job `processing` and is dropped, so no double run.
