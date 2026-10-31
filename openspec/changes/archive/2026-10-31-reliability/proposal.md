# Proposal

## Why

The task names six critical implementation details. Priority and scheduled jobs are done, and
duplicate-free pickup is built but not yet proven with several workers. Three are still missing:
a failed attempt is re-queued immediately with no backoff, a job whose worker dies mid-run stays
`processing` forever, and submitting the same job twice creates two jobs. This change closes the
remaining milestone-5 items (except the job log, which is built separately) and fills in
`DECISIONS.md` sections 1, 2 and 4.

## What Changes

- **Retry with backoff**: after a failed attempt with attempts left, the next attempt waits for a
  delay that grows with each attempt instead of running at once. The error is still stored, and the
  last attempt still fails the job for good.
- **Crash recovery**: a job held by a worker that died (crash, kill, lost network) is detected and
  recovered. It goes back to waiting and runs again if attempts remain, otherwise it fails. A job
  that is waiting in Postgres but has no entry on the queue (the enqueue failed, or Redis lost its
  data) is put on the queue again.
- **Idempotency**: a client can send an idempotency key with a submission. A second submission with
  a key that was already used returns the existing job and does not create a new one.
- **Concurrent pickup, proven**: tests show that several worker instances working on the same queue
  never run one job twice. Behaviour does not change; the existing guarantee gets the scenarios and
  tests that prove it.
- `DECISIONS.md`: section 4 (retry backoff: approach and timings) is written, section 2 (crash
  recovery) is completed, and section 1 (pickup) gets a reference to the proof.

## Capabilities

### New Capabilities

- `job-recovery`: how jobs whose worker died, and waiting jobs with nothing on the queue, are
  detected and brought back to a state where they run or end.
- `job-idempotency`: how a submission with an idempotency key that was already used is recognised
  and answered.

### Modified Capabilities

- `job-state-reporting`: a failed attempt with attempts left is retried after a backoff delay, not
  at once.
- `job-execution`: several worker instances never run the same job twice (new scenarios), and what
  happens to a job left `processing` when the grace period runs out changes (it is recovered).
- `job-management`: submission accepts an optional idempotency key; the job response shows it.
- `job-status-change`: a manual retry clears the scheduled time left by a backoff retry; a job
  waiting for its retry is cancelled like any scheduled job.
- `queue-statistics`: a failed attempt that will be retried counts as scheduled, not pending.
- `job-ui`: the job page shows the job's idempotency key; the submit form does not change.

## Impact

- `packages/contracts`: the job request and job schema (idempotency key), run and attempt on state
  reports, the maximum processing time on the internal job read, the job error codes as one closed
  list, the new error code `IDEMPOTENCY_KEY_CONFLICT`.
- `apps/job-service`: backoff when queuing a retry, the recovery pass (lost workers, timed-out and
  unqueued jobs), the idempotency check on submit (single and bulk) with a stored request
  fingerprint; a Prisma migration (idempotency key and fingerprint); new config (retry delays,
  recovery interval and minimum age, maximum processing time per type).
- `apps/job-execution-service`: run and attempt on every report, the handler timeout, the
  stalled-entry settings of the queue consumer, the warning for a recovered attempt.
- Tests at every level, including a system e2e with several workers and one that is killed.
- `DECISIONS.md` sections 1, 2 and 4; `docs/roadmap/05-reliability.md` (the four items are done
  in this one change).
