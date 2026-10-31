# Design

## Context

See proposal.md for the motivation and decisions.md for every behaviour choice; the specs under
`specs/` hold the requirements. Today:

- `JobServiceImpl.update` applies a worker's report as a conditional update
  (`JobRepository.update` with `expected: { status, attempts }`); a failed attempt with attempts
  left goes back to `pending` and attempt `attempts + 1` is queued at once. Reports carry only the
  target status; the entry's run is stripped by the worker (`BullMqJobQueueConsumer.toEntry`).
- `BullMqJobQueue` adds one entry per attempt under `<jobId>_<run>_<attempt>`; BullMQ 6.5.1 ignores
  an `add` for an existing id and refuses to `remove` a locked (active) entry. The consumer runs
  with BullMQ's defaults (`maxStalledCount: 1`, `lockDuration` and `stalledInterval` 30 s), so a
  stalled entry is handed out once more today. With `maxStalledCount: 0` the stalled checker of any
  worker moves the entry back to `wait` with a deferred failure, and the next worker to take it
  fails it without running the processor (checked in `moveStalledJobsToWait-9.lua` and
  `Worker.getUnrecoverableErrorMessage`).
- `JobExecutionImpl` runs handlers with `AbortSignal.any([shutdown, cancel])`; any abort means
  "stopped, report nothing". A 409 on a report is "refused", logged at info level.
- `HttpJobRepository` maps a 409 to `JobStatusConflictError({ id })` without the status.
- job-group-service already runs a timer with `@nestjs/schedule`'s `SchedulerRegistry`
  (`JobGroupPoll`); job-service has no timer yet.
- Enqueue failures are logged and leave the job in its status; `DECISIONS.md` promises the sweep.
- The system e2e stack runs two execution instances (`EXECUTION_INSTANCES`) with the compose
  defaults; `Stack` can start, stop, list and read logs of services, not kill a container.

## Goals / Non-Goals

**Goals:**
- One lifecycle rule for every failed attempt (worker report, lost worker, timeout): the same
  code path decides retry-with-backoff or final failure.
- Recovery that never changes a job another party changed first, and that is correct with several
  job-service instances.
- Idempotency without a read-then-write race: Postgres' unique index decides, the service only
  interprets the outcome.
- No new liveness protocol: BullMQ's lock is the only signal of a running worker.

**Non-Goals:**
- Exactly-once execution (decided: at-least-once; a lost result report runs the job again).
- Recovery when no worker is alive (decided: only the time limit backstop acts then).
- A UI for keys or next-attempt times beyond the Details row (decided).
- The job log (its own change).

## Decisions

### D1. Contracts (`packages/contracts`)
- `JOB_LIMITS.idempotencyKey = { minLength: 1, maxLength: 255 }`; `CreateJobOptions` gains
  `idempotencyKey: z.string().min(...).max(...).optional()`; `JobBase` gains
  `idempotencyKey: z.string().nullable()`. `CreateJobsBulkRequest` gets a `superRefine` that adds
  an issue at `jobs.<i>.idempotencyKey` for the second and later items repeating a key.
- `UpdateJobRequest`: every variant gains `run: z.int().positive()` and `attempt: z.int().positive()`.
- `InternalJob`: the `Job` union whose members are extended with `maxProcessingMs: z.int().positive()`;
  the body of `GET /internal/v1/jobs/:id`. The PATCH answer stays a `Job`.
- `jobs/job-error-codes.ts`: `JOB_ERROR_CODES` moves here from the worker, plus `workerLost:
  'WORKER_LOST'` and `jobTimeout: 'JOB_TIMEOUT'`. Handler-specific codes (webhook, flight transit)
  stay in their worker modules; `JobError.code` stays an open string.
- `ERROR_CODES` (kernel) gains `IDEMPOTENCY_KEY_CONFLICT`; the shared filter maps it to 409.
  `details` is `{ idempotencyKey, existingJobId }`.
- `CreateJobsBulkResponse` keeps `{ items }`; the HTTP status comes from the service (D2).

### D2. Idempotency in job-service
- Prisma: `idempotencyKey String? @unique @map("idempotency_key") @db.VarChar(255)` and
  `requestFingerprint String? @map("request_fingerprint") @db.Char(64)` (hex SHA-256). Postgres
  treats `NULL`s as distinct, so jobs without a key never collide. One migration adds both columns,
  the unique index, and a `(status, updated_at)` index for D5's queries.
- Domain port `JobRequestFingerprint` (`domain/jobs/job-request-fingerprint.ts`):
  `of(req: OfJobRequestFingerprintRequest { job: CreateJobRequest }): OfJobRequestFingerprintResponse { fingerprint }`.
  Infra `Sha256JobRequestFingerprint`: builds the canonical request
  `{ type, payload, priority, maxAttempts, groupId: groupId ?? null, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null }`
  (defaults already applied by Zod, the key itself excluded), serialises it with
  `safe-stable-stringify` (decided) and hashes with `createHash('sha256')` from `node:crypto`.
  *Alternative rejected:* comparing stored job fields; a backoff retry rewrites `scheduledAt`.
- `JobRepository`: `create`/`createMany` take `idempotencyKey` and `requestFingerprint` in `NewJob`;
  new `findByIdempotencyKeys(req: { keys: string[] }): { jobs: StoredJob[] }` where `StoredJob =
  { job, run, requestFingerprint }` (the existing `get` returns the same shape; `GetJobRepositoryResponse`
  becomes `StoredJob`). A unique violation on the key (`P2002` naming `idempotency_key`) surfaces as
  `IdempotencyKeyTakenError`, an error internal to job-service (it never reaches the HTTP filter),
  so the use case can re-read.
- `JobService.create` returns `{ job, created: boolean }`; `createMany` returns `{ jobs, created }`
  (`created` true when at least one job was inserted). `JobsController` answers 201 when `created`,
  200 otherwise, through `@Res({ passthrough: true })`.
- Single submit flow: (1) schema validation at the edge, (2) if a key is present: fingerprint,
  `findByIdempotencyKeys`; a hit with an equal fingerprint returns `{ job, created: false }`; a hit
  with another fingerprint throws `IdempotencyKeyConflictError`; (3) the time-dependent rules
  (departure day, max ahead) as today; (4) store; on `IdempotencyKeyTakenError` go back to (2) once
  (the concurrent writer has committed by then). The key lookup runs before the time rules, as
  decided, so a replay of a once-valid request answers 200.
- Bulk flow: contract rejects repeated keys; fingerprint keyed items; one `findByIdempotencyKeys`;
  any hit with another fingerprint → `IdempotencyKeyConflictError` (whole bulk, nothing stored);
  hits with equal fingerprints are reused at their positions; the remaining items go through the
  time rules and one `createManyAndReturn`; on `IdempotencyKeyTakenError` the lookup and insert are
  repeated up to a bounded number of times (`BULK_INSERT_TRIES = 3`), then the error is rethrown
  and becomes the generic 500 (decided). Reused jobs are not re-queued; new ones are, as today.
- The single flow needs no retry bound: after one violation the key exists.

### D3. Retry with backoff (job-service)
- Domain port `RetryDelay` (`domain/jobs/retry-delay.ts`): `of(req: { retry: number }): { delayMs }`
  (retry 1 = the delay before the second attempt). Infra `ExponentialJitterRetryDelay` with deps
  `{ random: Random }` and params `{ minMs, maxMs, capMs }`: draws `random.int` in
  `[min · 2^(retry−1), max · 2^(retry−1)]`, each bound capped at `capMs`. Config
  `JOB_SERVICE_RETRY_MIN_DELAY_MS` (5000), `JOB_SERVICE_RETRY_MAX_DELAY_MS` (30000),
  `JOB_SERVICE_RETRY_CAP_DELAY_MS` (300000). `RANDOM` is provided by `SystemRandom` in `JobsModule`.
  *Why no library:* this is a stored schedule time, not a retry loop; the worker's call retries
  already use `p-retry`.
- `JobServiceImpl.failureChanges`: attempts below max → `{ status: 'scheduled', error, scheduledAt:
  now + delay, completedAt: null }`, then `enqueue({ attempt: attempts + 1, runAt: scheduledAt })`;
  `JobChanges` gains `scheduledAt?: string | null`. The last attempt is unchanged (`failed`).
- Manual retry (`changeStatus` → `retry`) also sets `scheduledAt: null` (decided).
- `STARTABLE_JOB_STATUSES` already includes `scheduled`, so the worker's start is unchanged; the
  statistics count the job as scheduled with no change to the SQL.

### D4. Attempt-aware reports and the idempotent start
- `JobServiceImpl.update` checks `req.update.run === stored.run` and the attempt: for `processing`,
  `attempt === current.attempts + 1` from a startable status; for `completed`/`failed`,
  `attempt === current.attempts` while `processing`. Otherwise `JobStatusConflictError` with the
  current status (409). A `processing` report for a job already `processing` in the same run and
  attempt returns `{ job }` without a write (200). When the conditional start write loses
  (`JobStatusConflictError` from the repository), `update` re-reads once and, if the job is now
  `processing` in that run and attempt, returns it (two concurrent starts of one attempt both get
  200, the attempt is counted once); any other state rethrows.
- The attempt is in the condition already (`expected.attempts`), so the write itself does not change.

### D5. Recovery pass (job-service)
- Domain use case `JobRecovery` (`domain/jobs/job-recovery.ts`): `run(): Promise<RunJobRecoveryResponse
  { requeued, lostWorkers, timedOut }>`. Infra `JobRecoveryImpl` with deps `{ repository, queue,
  jobs: JobService, clock, logger }` and params `{ minAgeMs, intervalMs, batchSize, maxProcessingMs:
  Record<JobType, number> }`.
- Repository additions: `findWaitingSince(req: { before: Date; limit })` (status `pending`, or
  `scheduled` with `scheduledAt <= before`, and `updatedAt <= before`, oldest first) and
  `findProcessingSince(req: { before: Date; limit })` (status `processing`, `updatedAt <= before`),
  both returning `StoredJob[]`; `before = now − minAgeMs`. Served by the new `(status, updated_at)`
  index.
- `JobQueue` additions: `state(req: { jobId, run, attempt }): { state: 'waiting' | 'delayed' |
  'active' | 'finished' | 'missing' }` (BullMQ `getJobState`: `waiting`, `prioritized` and
  `waiting-children` → `waiting`; `delayed`; `active`; `completed`/`failed` → `finished`; `unknown` →
  `missing`), and `requeue(req: EnqueueJobQueueRequest)`: `getJob(id)?.remove()` then `add`; a
  remove refused because the entry is locked means a worker took it meanwhile, so `requeue` returns
  without adding. Both bounded by the enqueue timeout and throwing `JobQueueUnavailableError`.
- Per waiting job (entry = `attempts + 1` of the stored run): `waiting`/`delayed`/`active` → leave;
  `finished` → `requeue`; `missing` → `enqueue` (with `runAt: scheduledAt` for a scheduled job, which
  is in the past, so it is available at once).
- Per processing job (entry = `attempts` of the stored run): if `startedAt + maxProcessingMs[type] +
  intervalMs < now` → fail with `JOB_TIMEOUT`; else `active` → leave; `waiting`/`delayed`/`finished`
  → fail with `WORKER_LOST`; `missing` → leave (the time limit acts later). Failing goes through
  `JobService.update({ id, update: { status: 'failed', error, run, attempt } })`, exactly the path a
  worker's report takes, so one rule decides retry or final failure and the conditional write with
  the attempt check protects against a worker that reports at the same moment (a 409 is logged at
  info level and counted as nothing). Every recovery logs at warn level `{ jobId, run, attempt,
  reason }`.
- A `JobQueueUnavailableError` from `state`, `requeue` or `enqueue` ends the pass with one warn
  line, so a Redis outage costs one timeout per tick, not one per job. Each query takes at most
  `batchSize` jobs per tick (`JOB_SERVICE_RECOVERY_BATCH_SIZE`, 100); the rest waits for the next.
- Timer: the interval logic of job-group-service's `JobGroupPoll` (register an interval with
  `SchedulerRegistry`, skip a tick while one runs, log a failed run, on stop remove the interval and
  await the run in flight) moves into service-kit as `SchedulerIntervalTask` behind an
  `IntervalTask` port (decided during apply: no logic written twice), with `JobGroupPoll`'s tests.
  `JobGroupPoll` and the new `JobRecoverySchedule` (`app/jobs/`) are thin Nest lifecycle hooks around
  it: start on bootstrap, stop in `onModuleDestroy`, before the database closes. `@nestjs/schedule`
  joins the dependencies of service-kit and job-service (already used by job-group-service, same
  version); job-service imports `ScheduleModule.forRoot()`.
- Config: `JOB_SERVICE_RECOVERY_INTERVAL_MS` (30000), `JOB_SERVICE_RECOVERY_MIN_AGE_MS` (30000),
  `JOB_SERVICE_MAX_PROCESSING_MS_EMAIL` (30000), `..._WEBHOOK` (30000), `..._FLIGHT_TRANSIT` (60000).
  `JobServiceConfig` gains `recovery: { intervalMs, minAgeMs, batchSize }`, `retryDelay: { minMs,
  maxMs, capMs }` and `maxProcessingMs: Record<JobType, number>`.
- Internal read: `InternalJobsController.get` answers `{ ...job, maxProcessingMs: config.maxProcessingMs[job.type] }`.

### D6. Worker (job-execution-service)
- `BullMqJobQueueConsumer` params gain `lockDurationMs` and `stalledIntervalMs`; the `Worker` is
  created with `lockDuration`, `stalledInterval` and `maxStalledCount: 0`. Config
  `JOB_QUEUE_LOCK_DURATION_MS` (30000), `JOB_QUEUE_STALLED_INTERVAL_MS` (30000). The class comment
  about redelivery is replaced by the deferred-failure fact.
- `JobQueueEntry` gains `run`; `toEntry` keeps it. `JobExecutionImpl` sends `{ run, attempt }` in
  every report (`EntryFields` already holds `attempt`).
- `JobRepository.get` (worker) returns `{ job, maxProcessingMs }`, parsed with `InternalJob`.
- Timeout: before `handler.run`, `timeout = AbortSignal.timeout(maxProcessingMs)`; the handler gets
  `AbortSignal.any([entry.signal, timeout])`. After the handler settles or throws: cancel or
  shutdown aborted → `stopped` (as today); else `timeout.aborted` → `fail({ code: JOB_TIMEOUT,
  message, details: { maxProcessingMs } })`; else the normal outcome. Reports keep using
  `entry.signal`, so a timed-out job's failure report is not itself aborted.
- `HttpJobRepository` reads `details.status` of a 409 body into `JobStatusConflictError({ id,
  status })`. `JobExecutionImpl.outcome`: refused with status `cancelled` → info log as today;
  refused with any other status → warn log "Report refused: the attempt was recovered" with
  `jobId`, `run`, `attempt`; both return `skipped`.

### D7. job-ui
- `JobPresenter.idempotencyKey({ job })` gives the key's text (`null` without a key), and
  `JobDetailsList`, which builds the Details rows, appends the row `en.job.fields.idempotencyKey`
  only when that text is not `null`; the row is not added to `useJobFields`, so the transit
  report's Job card is unchanged. `en.ts` gets the label under the job fields (the submit section's
  label stays for the disabled field). Fixtures gain `idempotencyKey: null`.

### D8. Tests and the e2e stack
- Unit: `ExponentialJitterRetryDelay`, `Sha256JobRequestFingerprint` (key order, offset notation,
  defaults), `JobServiceImpl` (backoff, attempt checks, idempotent start, idempotency flows),
  `JobRecoveryImpl` (every branch of D5 with `mockDeep` ports and fake time), `JobRecoverySchedule`,
  worker `JobExecutionImpl` (timeout vs cancel, run/attempt in reports, recovered-refusal log),
  presenter.
- Integration: Prisma repository (unique key, `findByIdempotencyKeys`, the two `findSince` queries),
  `BullMqJobQueue.state`/`requeue` against Redis, `BullMqJobQueueConsumer` with two consumers on one
  queue ("Each entry goes to one consumer") and a stalled entry with short `lockDuration` and
  `stalledInterval` ("Stalled entry is not run again": the first consumer's processor never
  resolves, its lock is let expire by `skipLockRenewal`, the second consumer never runs it and the
  entry ends `failed`), `HttpJobRepository` (409 status, `InternalJob`).
- Per-app e2e: job-service `jobs.e2e.test.ts` (idempotency scenarios, 200/201, bulk), `internal-jobs.e2e.test.ts`
  (run/attempt, idempotent start, backoff `scheduledAt` with the real `SystemRandom` asserted within
  the configured range, `maxProcessingMs` on the read), a new `recovery.e2e.test.ts` (the pass
  driven by calling the `JobRecovery` use case from the container once, with the mocked `JobQueue`
  answering `state`; the harness's recovery interval is an hour so the timer never fires during a
  test, and one test checks the running app registers it). Two deliberate exceptions to the e2e
  rules: the pass has no HTTP route, so it is run through its use case; and a stuck job needs an old
  last change, which neither a route nor the repository can produce (Prisma's `@updatedAt` sets it
  on every write), so the harness's `age` moves `updated_at`, `started_at` and `scheduled_at` back
  with raw SQL through the app's own `PrismaDatabase`. Jobs reach their stuck state through the
  routes wherever one can (submit, start report) before they are aged; worker e2e (`job-execution.e2e.test.ts`: timeout, recovered refusal).
- System e2e: `EXECUTION_INSTANCES` becomes 3. `STACK_ENV` adds short settings passed through compose
  (`${VAR:-default}` entries): recovery interval and min age 2 s, stalled interval 2 s, lock
  duration 3 s (changed during apply from 2 s, so a second of busy event loop cannot make a live
  worker look dead), retry delays 1–2 s, cap 4 s (changed from 0.5–1 s, so a test can catch a job
  while it waits for its retry). `Stack` gains `kill(req: { container })` (`docker kill`)
  and `exec(req: { service, command })` (`docker compose exec`). Tests: "Many jobs on several
  instances complete once each" (a bulk of 60 email jobs, every one `completed` with attempts 1);
  "Killed worker's job is recovered on the full system" (a bulk larger than the stack's concurrency,
  kill one instance while jobs run, every job ends `completed`, at least one with attempts 2, and
  job-service logged `WORKER_LOST`); "Pending job recovers on the full system" (a bulk, then
  `redis-cli FLUSHALL` through `exec`, every job completes); "Bulk retried after a lost answer on
  the full system".

### D9. DECISIONS.md and roadmap
Section 1 gets the proof (the two-consumer integration test and the scaled e2e); section 2 is
written: lock as liveness, `maxStalledCount: 0` and BullMQ's deferred failure, the pass and its
two predicates, the time limit with its margin, the worst-case latency, at-least-once, what
happens without any worker; section 4: the formula, the configured timings, the cap, retry via
`scheduled`; an idempotency sub-section: key in the body, fingerprint, 200 vs 409, key lifetime,
the global namespace, the bulk rules. `docs/roadmap/05-reliability.md` marks the four items done
in `reliability` and ticks the backoff open question.

## Risks / Trade-offs

- [BullMQ's stalled checker runs only inside workers] → with no worker alive a lost entry stays
  `active`; the time limit backstop still recovers the job. Written down in `DECISIONS.md`.
- [A worker that is only slow loses its attempt to `WORKER_LOST`] → its later report is refused by
  the attempt check and logged at warn level; the job runs again (at-least-once).
- [Redis data loss while jobs run] → processing jobs keep running; their entries are `missing`, so
  only the time limit acts; waiting jobs are re-queued by the pass.
- [Lock renewal blocked by a busy event loop] → `lockDuration` 30 s against handlers of 1–3 s; the
  e2e stack's 2 s is for tests only.
- [Fingerprint drift] → the canonical form is built from the Zod-parsed request (defaults applied)
  and hashed the same way on every path; one unit test pins the canonical string of a sample request.
- [Idempotent start accepting a wrong worker] → impossible without a second holder of the same
  entry, which `maxStalledCount: 0` rules out; a stale run or attempt still gets 409.
- [Two job-service instances recovering at once] → both compute the same change; the conditional
  write lets one win, the other logs a 409 at info level. `requeue` of a finished entry twice ends
  with one entry (add is ignored for an existing id).
- [`InternalJob` adds a field the worker must know] → the contract is shared; the worker fails
  closed (`InvalidJobError`) if it is missing.
- [System e2e timing] → short intervals in `STACK_ENV`; assertions on final states with generous
  `expect.poll` timeouts, never on exact instants.

## Migration Plan

One Prisma migration: `idempotency_key VARCHAR(255) NULL UNIQUE`, `request_fingerprint CHAR(64) NULL`,
index `(status, updated_at)`. Entries already in Redis keep their ids; old workers' reports without
`run`/`attempt` are rejected with 400, so deploy job-service and job-execution-service together
(the compose stack does). Rollback: the old code ignores the new columns; the e2e-only short
settings live in the suite, not in `.env.example`.
