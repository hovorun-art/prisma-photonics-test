# Design

## Context

See `proposal.md` for the why and `specs/` for the behaviour. Current state that shapes the approach:

- `packages/contracts/src/jobs/job.ts` already has the `scheduled` status, `JOB_LIMITS.priority`
  (1–10, default 5, higher = more urgent) and `Job.scheduledAt` (`Timestamp.nullable()`, UTC `Z`
  form). `CreateJobOptions` has no `scheduledAt`.
- The Prisma `jobs` table already has `priority` and `scheduled_at`; no migration is needed.
- `JobServiceImpl.newPendingJob` always stores `status: 'pending'`, `scheduledAt: null`, and
  `update` accepts `processing` only from `pending` (`requireStatus`). The repository writes with
  compare-and-set on the loaded status and attempts, so a `scheduled` start keeps the single-winner
  guarantee without new SQL.
- `JobQueue.enqueue` / `enqueueMany` take `{ jobId, attempt }`; `BullMqJobQueue` adds entries with
  id `<jobId>_<attempt>` and no options, so BullMQ runs them FIFO.
- `JobExecutionImpl.read` skips every job whose status is not `pending`.

## Goals / Non-Goals

**Goals:**
- Priority and delay are queue-entry options passed through our own `JobQueue` port; BullMQ stays
  behind the adapter.
- One shared definition of "a status a worker may start" used by job-service and
  job-execution-service.
- Deterministic tests: the adapter's delay and the horizon check use the injected `Clock`.

**Non-Goals:**
- No job-ui changes (`priority-scheduling-ui`).
- No re-queueing of scheduled or pending jobs whose entry never reached the queue (`crash-recovery`).
- No editing of priority or `scheduledAt`, no cancel (`job-update`, `job-cancel`).
- No priority ageing.

## Decisions

**1. Contract additions (`packages/contracts`).**
- `CreateJobOptions.scheduledAt: z.iso.datetime({ offset: true }).optional()`: accepts `Z` and
  `±hh:mm`; a date only or a local time without offset fails the schema with an issue at
  `scheduledAt`. The response's `Job.scheduledAt` stays the UTC form; job-service stores the instant
  and returns it normalised (spec: "the same instant, returned in UTC").
- `JOB_LIMITS.scheduledAt = { maxAheadDays: 30 }`, next to the priority range, so the later UI change
  uses the same value.
- `STARTABLE_JOB_STATUSES = ['scheduled', 'pending'] as const satisfies readonly JobStatus[]`,
  next to `FINISHED_JOB_STATUSES`.
- *Alternative:* a `z.refine` against `Date.now()` in the schema for the horizon. Rejected: makes
  the shared schema time-dependent and untestable without global fakes; the horizon is a job-service
  rule checked with its `Clock`, like the flight departure day.

**2. Creating scheduled jobs (`JobServiceImpl`).**
- `newPendingJob` becomes `newJob({ job, now, createdAt? })`: status `scheduled` when
  `scheduledAt > now`, else `pending`; `scheduledAt` stored as given (`null` when absent).
- A private `scheduleIssues({ job, now })` returns an issue at `['scheduledAt']` when `scheduledAt`
  is more than `maxAheadDays` after `now` (exactly the maximum is allowed), with the maximum in the
  message. `create` throws `InvalidJobFieldError({ field: [], issues })`; `createMany` maps the
  issues to `[index, 'scheduledAt']` under `field: ['jobs']`, alongside the departure-day issues,
  judged at the single `now` the bulk already uses. All checks run before anything is stored.
- *Alternative:* a separate error code for the horizon. Rejected: the spec says `VALIDATION_FAILED`
  with a field issue, the same shape as every other invalid field.

**3. Queue port and BullMQ adapter.**
- `EnqueueJobQueueRequest` gains `priority: number` (our scale) and `runAt: string | null` (ISO
  instant; `null` or not in the future = available now). The port documents "higher priority is
  taken first, FIFO within one priority; an entry with `runAt` is not available before it".
- `BullMqJobQueue` gets `clock: Clock` in its deps and maps per entry:
  `priority: JOB_LIMITS.priority.max + 1 - priority` (10 → 1, BullMQ's most urgent; 1 → 10) and
  `delay: max(0, runAt - clock.now())`. Every entry always gets a priority, because BullMQ takes
  entries without one ahead of all prioritised entries. `addBulk` takes the same options per entry,
  so a bulk stays one transaction.
- `JobServiceImpl` passes the job's `priority` and its `scheduledAt` for the first attempt, and the
  job's `priority` with `runAt: null` for a retry (backoff timing belongs to `retry-backoff`).
- *Alternatives:* a job-service promoter loop moving due `scheduled` jobs to `pending` (keeps the
  schedule in Postgres, but adds a loop and up to one interval of lateness); one queue per priority
  level (more of our own logic and round trips). Both were offered; the user chose BullMQ's
  priority and delayed entries.

**4. Starting a scheduled job.**
- job-service `update` with `processing` requires the current status to be in
  `STARTABLE_JOB_STATUSES` instead of `pending`; the compare-and-set `expected` is the loaded status,
  so two starts of one scheduled job still yield one 200 and one 409. No time check: the queue
  enforces the delay (decided).
- job-execution-service `read` skips a job whose status is not in `STARTABLE_JOB_STATUSES`; the log
  text becomes "job is no longer startable".

**5. Tests per level.**
- Contracts unit: `scheduledAt` accepts `Z` and offsets, rejects date-only and no-offset.
- job-service unit (`job-service.impl.test.ts`, fake clock): scheduled vs pending vs past, horizon
  boundary (exactly max accepted, max + 1 ms rejected), bulk index paths, enqueue arguments
  (priority, `runAt`) for create, bulk and retry, start of a scheduled job, queue failure keeps
  `scheduled`.
- job-service integration (`bullmq-job-queue.int.test.ts`, real Redis, a plain BullMQ `Worker` in
  the test reading entries one at a time): priority order, FIFO within a priority, a delayed entry
  is not handed out before its time, a due high-priority delayed entry overtakes waiting lower ones.
  Repository int test: two concurrent starts of a `scheduled` job.
- job-service e2e (`jobs.e2e.test.ts`, `internal-jobs.e2e.test.ts`): HTTP behaviour of submit,
  validation and start, with the queue mock asserting priority and `runAt`.
- job-execution-service unit (`job-execution.impl.test.ts`): a `scheduled` job runs and is reported.
- System e2e (`tests/system-e2e/jobs.spec.ts`): a job scheduled a few seconds ahead is `scheduled`,
  then `completed` with `startedAt >= scheduledAt`.

**6. Docs.** `DECISIONS.md` section 3 (Priority Queue Implementation) is written: BullMQ's priority
with our mapping, FIFO ties, strict priority without ageing as a trade-off, retries keep priority,
scheduled jobs as delayed entries and why (with the rejected promoter). Section 1's "FIFO for now"
note is updated. `docs/roadmap/05-reliability.md` gains `priority-scheduling-ui`.

## Risks / Trade-offs

- [The schedule lives in Redis: a Redis data loss or a failed enqueue leaves a job `scheduled`
  forever] → logged at submit; the `crash-recovery` sweep re-queues stuck `scheduled` and `pending`
  jobs; stated in `DECISIONS.md`.
- [Delay is computed from job-service's clock, the due time checked by Redis/BullMQ's] → seconds of
  skew only shift the start; no second time check that could drop the entry (decided).
- [Strict priority starves low-priority jobs under sustained high-priority load] → documented
  trade-off; ageing is a possible later change.
- [A retry of a scheduled job goes to `pending`, not back to `scheduled`] → intended: the time has
  passed; the job keeps its `scheduledAt` as history.
- [Delayed entries up to 30 days occupy Redis memory] → bounded by the horizon; one small entry per
  job.

## Migration Plan

No schema migration. Entries already in Redis have no priority and are taken before prioritised
ones until drained; acceptable for this project (dev data only). Rollback: revert the change; queued
delayed entries would then run at their time, and job-service would reject their start (409) since
`scheduled` is no longer startable, leaving those jobs `scheduled`.
