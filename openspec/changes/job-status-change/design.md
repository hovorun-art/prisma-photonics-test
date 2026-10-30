# Design

## Context

See proposal.md for the motivation and decisions.md for every behaviour choice. Today:

- job-service owns job state. `JobServiceImpl.update` applies the worker's state reports as
  conditional updates (`JobRepository.update` with `expected: { status, attempts }`), so a concurrent
  change loses with `JobStatusConflictError`. A failed attempt with attempts left is re-queued as
  attempt `attempts + 1`.
- Queue entries are BullMQ jobs with the id `<jobId>_<attempt>` (`JobQueueEntryId` in contracts), so
  the same attempt is never queued twice. The consumer keeps the last 1 000 finished entries
  (`removeOnComplete` / `removeOnFail`), so an entry id stays taken long after the attempt ran.
- job-execution-service reads the job, reports `processing`, runs the handler with an `AbortSignal`
  (today aborted only when the shutdown grace period runs out) and reports the outcome. A job that is
  not `pending` when read is skipped, so a cancelled waiting job is already never run.
- job-ui already computes `actions.cancel` / `actions.retry` in `JobPresenter` and renders the
  buttons wrapped in `ComingSoon`.

## Goals / Non-Goals

**Goals:**
- One public route for both actions, with the same conditional-update guarantees as the worker's
  reports.
- A retry re-queues the job even though its first attempt's entry id is already taken.
- A running job stops within the time a pub/sub message needs, without the worker polling.

**Non-Goals:**
- Removing a cancelled job's entry from the queue (decided: it is left and skipped).
- Guaranteed delivery of the cancel signal: a lost message only means the handler runs to its end,
  and its report is refused (decided safety net).
- Row actions on the jobs list, bulk cancel or retry, the later `job-update` change's fields.

## Decisions

### D1. Contract: `ChangeJobStatusRequest`
`packages/contracts/src/jobs/job.ts` gets
`ChangeJobStatusRequest = z.discriminatedUnion('status', [{ status: 'cancelled' }, { status: 'pending' }])`
and the type. A missing or other status fails Zod with an issue at `status` → 400
`VALIDATION_FAILED` through the existing validation pipe. `PATCH /v1/jobs/:id` answers `Job`.
Alternative: two action routes (`/cancel`, `/retry`) — rejected by the user.

### D2. job-service use case: `JobService.changeStatus`
A new method on the `JobService` interface, separate from the worker's `update` (different callers,
different rules):
`changeStatus(req: ChangeStatusJobServiceRequest { id, change: ChangeJobStatusRequest }): Promise<ChangeStatusJobServiceResponse { job }>`.
Throws `JobNotFoundError` or `JobStatusConflictError` (existing codes, existing HTTP mapping 404/409).
- **Cancel**: allowed from `pending`, `scheduled`, `processing` (a `CANCELLABLE_JOB_STATUSES` list in
  contracts, used by job-ui too); changes `{ status: 'cancelled', completedAt: now }`. After the update
  commits, `JobQueue.cancel({ jobId })` publishes the cancellation; a publish failure is logged
  (warn, with `jobId`) and swallowed: the job is already cancelled and the late report is refused.
  It is published for every cancel, not only from `processing`: a job read as `pending` may have been
  started by a worker an instant later, and publishing is cheap.
- **Retry**: allowed only from `failed`; changes `{ status: 'pending', attempts: 0, error: null,
  result: null, startedAt: null, completedAt: null, run: run + 1 }`, then enqueues attempt 1 of the
  new run. `JobQueueUnavailableError` is caught and logged as on submit (job stays `pending`).
- Both go through `JobRepository.update` with `expected: { status, attempts }`, so two concurrent
  changes, or a change racing a worker report, let exactly one win (the conditional `UPDATE ... WHERE
  status = $expected` already used for reports).
- `requireStatus` grows a list form (`requireStatusIn`) for the cancel case.

### D3. Re-queueing a retried job: a `run` counter in the entry id
The first attempt of a retried job needs an entry id that was never used. A job gets an internal
`run` column (`Int`, default 1, Prisma migration), incremented by each retry; entry ids become
`<jobId>_<run>_<attempt>`. Every enqueue (submit, bulk, failure retry, manual retry) passes the job's
`run`; `EnqueueJobQueueRequest` gains `run`. `run` is not part of the public `Job` contract (not
decided as API), so `JobRepository` returns it next to the job where the service needs it
(`get` used by `update`/`changeStatus` returns `{ job, run }` via a `StoredJob` type; the public
routes map to `job` only), and `ExpectedJobState` stays `{ status, attempts }`.
`JobQueueEntryId.decode` accepts `<jobId>_<run>_<attempt>` and, for entries queued before the deploy,
the old `<jobId>_<attempt>` as run 1; the worker only uses `jobId` and `attempt`.
Alternatives: removing the old entries before re-adding (races with an entry still `active` just
after its failure report: the remove fails and the add is ignored as a duplicate); a random suffix per
retry (failure retries inside one run would then need it too, so it has to be stored anyway).

### D4. Cancellation signal: Redis pub/sub behind the queue interfaces
- Contracts: `JOB_CANCELLATIONS_CHANNEL = 'job-cancellations'` and
  `JobCancellationMessage = z.object({ jobId: z.uuid() })` in `job-queue.ts`.
- job-service: `JobQueue.cancel(req: CancelJobQueueRequest { jobId }): Promise<CancelJobQueueResponse>`.
  `BullMqJobQueue` publishes with the queue's own Redis client (`await this.queue.client`), bounded by
  the same timeout as enqueue; it throws `JobQueueUnavailableError` on failure, which `changeStatus`
  logs and swallows (D2).
- job-execution-service: a new domain port `JobCancellations extends Closable` with
  `listen(req: ListenJobCancellationsRequest { onCancel: (jobId) => void })`, implemented by
  `RedisJobCancellations` (infra/queue) on its own ioredis connection (a subscribing connection
  cannot run other commands), closed on shutdown with the consumer. Messages are parsed with
  `JobCancellationMessage` at the edge; an invalid one is logged (warn) and ignored.
- Pub/sub is fire-and-forget: every worker gets every message and ignores ids it does not run. Redis
  stays a queue/transport only; Postgres stays the truth.
Alternatives: polling the job through the internal API while it runs (slower than most job
durations, extra load); BullMQ's own cancellation (only in BullMQ Pro).

### D5. Worker: per-job abort
`JobExecution` gets `cancel(req: CancelJobExecutionRequest { jobId }): CancelJobExecutionResponse`,
called by the cancellation listener (wired in the execution module's bootstrap hook).
`JobExecutionImpl` keeps a `Map<jobId, AbortController>` of the jobs it runs. An entry is added
**before** the `processing` report is sent, so a cancel published right after job-service accepted
the start is not missed, and removed when `execute` settles. Handlers, report calls and reads get
`AbortSignal.any([shutdown.signal, perJob.signal])`. After the handler settles (or a report call
rejects) with the per-job signal aborted, `execute` logs "Stopped: job was cancelled" at info level
and returns a new outcome `'cancelled'`, sending nothing more. A `completed`/`failed` report answered
with `JobStatusConflictError` (the lost-message safety net) is logged at info level ("Report refused:
job changed meanwhile") and returns `'skipped'` instead of today's silent `'abandoned'`.

### D6. job-ui
- `JobsApi.changeStatus(req: ChangeStatusJobsApiRequest { id, status }): Promise<{ job }>`, `PATCH`
  in `FetchJobsApi`.
- `useChangeJobStatus(id)` (TanStack `useMutation`): on success `setQueryData(['job', id], job)` so
  the page shows the new state at once, and invalidates `['jobs']` and the statistics queries.
- `CancelJobDialog` (like `DeleteJobDialog`): confirm button disabled while pending, API error message
  in the dialog, closes on success. Retry: a `RetryJobButton` disabled while pending; its error is an
  `Alert` (`role="alert"`) under the header actions.
- `JobPresenter.actions` uses `CANCELLABLE_JOB_STATUSES` (adds `processing`); `ComingSoon` wrappers
  are removed. New locale strings: cancel dialog title, description, confirm ("Cancel job") and
  dismiss ("Keep job" is taken by delete; reuse it).

### D7. Tests
- Contracts: `ChangeJobStatusRequest`, `JobQueueEntryId` (new and legacy formats),
  `JobCancellationMessage`.
- job-service unit (`job-service.impl.test.ts`): every allowed/refused transition, publish/enqueue
  calls and swallowed queue failures. Integration: `bullmq-job-queue.int.test.ts` (entry ids with run,
  `cancel` publishes on the channel), Prisma repository (`run` stored and returned). Per-app e2e:
  `jobs.e2e.test.ts` for the route scenarios, concurrency scenarios against the real database,
  `internal-jobs.e2e.test.ts` for reports on a cancelled job.
- job-execution-service unit: `job-execution.impl.test.ts` (cancel aborts only its job, no report,
  info log; refused completion). Integration: `redis-job-cancellations.int.test.ts` against real
  Redis. Per-app e2e: a cancellation delivered through the mocked `JobCancellations` port.
- job-ui: presenter, `fetch-jobs-api`, `job-page.test.tsx` scenarios.
- System e2e (`jobs.spec.ts` / `job-ui.spec.ts`): cancel — submit a bulk of email jobs larger than the
  stack's total concurrency and cancel the last one from its page while it still waits; retry —
  submit webhook jobs with max attempts 1 until one fails (bounded loop), retry it from its page and
  wait for it to finish again.

### D8. DECISIONS.md
Section 0 gets "Cancel and retry": pub/sub for cancellation (and why not polling or BullMQ Pro), the
`run` counter in entry ids, and the refused-report safety net.

## Risks / Trade-offs

- [A cancel message is lost (subscriber reconnecting, Redis down)] → the handler runs to its end;
  its report is refused and the job stays `cancelled` (spec'd). Only the work is wasted.
- [The handler ignores its abort signal] → it keeps running until it returns, then reports nothing;
  all current handlers sleep through the injected `Sleeper` with the signal.
- [A cancel arrives between a worker reading `pending` and registering the job] → registration
  happens before the `processing` report, and a cancel that commits before the report makes the
  report fail with 409, so the job is never run.
- [System e2e timing for "cancel while waiting"] → the bulk is sized well above the stack's
  concurrency; the test asserts on the final state only.
- [Extra column and entry-id format] → a migration with a default; legacy ids still decode.

## Migration Plan

One Prisma migration adds `run INT NOT NULL DEFAULT 1` to `jobs`. Entries already in Redis keep their
old ids and are still decoded. Rollback: the old code ignores `run`; entries with the new id format
would fail the old decoder, so drain the queue before a rollback.
