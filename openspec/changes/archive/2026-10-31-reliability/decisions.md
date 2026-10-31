# Decisions: reliability

## Decided

- One change `reliability` on the existing `reliability` branch covering retry-backoff,
  crash-recovery, idempotency and a proof of concurrent pickup; one task group per item (user)
- The job log is out of scope; it is built on its own branches (user)
- An automatic retry sets the failed job to `scheduled` with `scheduledAt` = now + the delay, and queues its next attempt as a scheduled entry; one mechanism for scheduled jobs and retries, no separate retry logic (user)
- No separate "next attempt" field: the job's `scheduledAt` shows when the next attempt starts (user)
- Retry delays grow: retry n waits a random time in [5 s, 30 s] × 2^(n−1), capped at 5 min (retry 1: 5–30 s, retry 2: 10–60 s, retry 3: 20–120 s); the numbers are config (user)
- A job whose worker died counts as a failed attempt with the stored error code `WORKER_LOST`: it is retried like any failure (`scheduled` with the retry delay) or fails for good on its last attempt (user)
- No heartbeat of our own: BullMQ's lock on an active entry is the worker's liveness signal (user)
- Crash recovery is one job-service loop that reconciles Postgres with the queue: a `pending` or due `scheduled` job with no live entry for its next attempt (live: `waiting`, `prioritized`, `delayed` or `active`) is queued again; a `processing` job whose current attempt's entry exists but is no longer `active` (back in waiting after a stall, failed or completed) gets `WORKER_LOST`; a `processing` job whose entry is missing altogether (e.g. Redis lost its data) is left to the processing-time backstop, since a missing entry cannot be told from a lost worker and most such jobs are still running fine. It covers a crashed worker, a shutdown past its grace period, a lost start or result report and Redis losing data; workers need no new code (user)
- BullMQ worker settings: `maxStalledCount: 0`, `lockDuration` 30 s, `stalledInterval` 30 s; config. What BullMQ 6.5.1 does with it (checked in its stalled script): an `active` entry whose lock expired is moved back to waiting by the next stalled check of any worker, marked with a deferred failure, and failed without running by the next worker that takes it; it is never run again. The reconcile loop then recovers the job. With no worker alive nothing moves and only the backstop recovers. Worst-case recovery of a crashed worker's job: lock duration + stalled interval + loop interval + backoff delay, about 2 minutes with the defaults; `DECISIONS.md` section 2 says so (user)
- A queue entry is identified by the job id and its attempt (`<jobId>_<run>_<attempt>`, the run counting manual retries): one entry per attempt, and the reconcile loop looks each job's entry up by that id; re-queuing an attempt whose entry already finished replaces that entry under the same id (user)
- Every job type has a maximum processing time, configured in job-service only: email 30 s, webhook 30 s, flight-transit 60 s. The internal job response carries the job's maximum processing time, and the worker's abort timer uses that value, so the two services cannot drift (user)
- The worker aborts a handler that runs past its type's maximum processing time and reports a failed attempt with the code `JOB_TIMEOUT`; the job is retried with backoff or fails on its last attempt (user)
- Backstop: the reconcile loop fails a `processing` job whose start is older than its type's maximum processing time plus the loop interval (the margin, so the worker's own timeout wins in normal operation and the loop only when the worker is gone) with `JOB_TIMEOUT`, the same failed-attempt rule; when the two still race, the conditional write lets one win, and both store `JOB_TIMEOUT` (user)
- The loop runs every 30 s and only looks at jobs that have been in their state for at least 30 s, so a submit whose enqueue is still in flight is not touched; both are config (user)
- Idempotency: an optional `idempotencyKey` field in the job request body (each bulk item may carry its own), stored on the job and returned in the job response (user)
- A used key that comes with a different request answers HTTP 409 with the new code `IDEMPOTENCY_KEY_CONFLICT` and the existing job's id in `details`. "Different" is decided by a fingerprint stored with the key: a hash of the canonical request (type, payload, priority, max attempts, scheduled time, group; defaults applied, timestamps normalised, object keys sorted), not by comparing the stored job's fields, which later change (a backoff retry overwrites `scheduledAt`) (user)
- A repeated submission that matches the stored job answers HTTP 200 with the existing job (201 only when a job was created) (user)
- A key is remembered as long as its job exists: unique on the jobs table, freed when the job is deleted; nothing expires on a timer (user)
- In a bulk, an item whose key was already used (with a matching request) gets the existing job at its position and the other items are created; a used key with a different request makes the whole bulk answer 409 `IDEMPOTENCY_KEY_CONFLICT` (user)
- job-ui: the job page shows the job's idempotency key when it has one; the submit form does not change (no generated key, no key field) (user)
- Proof levels: an integration test with several BullMQ consumers on one real Redis (each entry to exactly one consumer); an integration test of the reconcile loop against real Postgres and Redis; a system e2e with job-execution-service scaled to 3 where many jobs each complete with exactly one attempt; a system e2e that kills a worker mid-job and sees the job recovered and completed; the e2e compose stack uses short recovery intervals (user)
- Every failure is retried while attempts remain, `INVALID_PAYLOAD` and `UNSUPPORTED_JOB_TYPE` included: the failure may come from an outdated worker that does not know a new payload or type yet (user)
- A manual retry (`failed` → `pending` by a client) runs at once, without backoff (user confirmed assumption)
- A job waiting for its retry is `scheduled` for every existing rule: it can be cancelled, it counts as scheduled in the statistics, and a worker skips its entry once it is cancelled (user confirmed assumption)
- State reports from a worker carry the run and the attempt they are for (both are in the entry id); a report whose run or attempt is not the job's current one is answered with HTTP 409 `JOB_STATUS_CONFLICT` and changes nothing (user confirmed assumption)
- The start report is idempotent for one attempt: a `processing` report for a job that is already `processing` in that run and attempt answers HTTP 200 with the job unchanged. One entry has one lock holder, so only the same worker can repeat its start, and a start whose answer was lost no longer drops the entry and costs the job an attempt (user)
- A worker whose report is refused because its attempt was recovered under it (it was only slow, e.g. its lock expired) drops the entry, sends nothing more and logs it at warn level (user confirmed assumption)
- A job whose result report never reached job-service runs again (at-least-once, not exactly-once); `DECISIONS.md` says so (user confirmed assumption)
- Recovery is safe with several job-service instances: each recovered job is changed with the same conditional write as every other transition, so only one instance recovers it (user confirmed assumption)
- Every recovery (lost worker, re-queued waiting job) is logged at warn level with the job id and attempt (user confirmed assumption)
- An idempotency key is a string of 1 to 255 characters; anything else answers 400 `VALIDATION_FAILED` with an issue for the key (user confirmed assumption)
- Two submissions with the same new key at the same time create exactly one job; the first answers 201, the other 200, both with that job (user confirmed assumption)
- A bulk answers HTTP 201 when it created at least one job and HTTP 200 when every item matched an existing job (user confirmed assumption)
- Two items of one bulk with the same idempotency key make the bulk answer 400 `VALIDATION_FAILED` (user confirmed assumption)
- `DECISIONS.md` section 4 is written in the retry group, section 2 in the crash-recovery group, section 1 gets the proof in the pickup group; idempotency gets its own sub-section (like scheduled jobs in section 3) (user confirmed assumption)
- `docs/roadmap/05-reliability.md` marks `retry-backoff`, `concurrent-pickup`, `crash-recovery` and `idempotency` as done in `reliability` (user confirmed assumption)
- Idempotency is enforced by job-service for every API client (single and bulk submits); job-ui only shows the key (user)
- The idempotency key is looked up after the body's schema validation and before the time-dependent rules (departure day over, scheduled too far ahead), so a replay of a request that was valid when first sent answers 200 with the existing job instead of 400 (user confirmed assumption)
- A bulk first reads the jobs of its keys, then inserts the rest; a unique-key violation from a concurrent request restarts the read and insert, a bounded number of times; exhaustion is an unexpected failure answered 500 INTERNAL_ERROR, no new public code for a race that needs several bulks to collide on one key within milliseconds (user confirmed assumption, status changed from 503 by the user during design)
- An idempotency key is one namespace for every client (there is no authentication to scope it); `DECISIONS.md` says so (user confirmed assumption)
- The job error codes (`WORKER_LOST`, `JOB_TIMEOUT`, and the worker's `INVALID_PAYLOAD`, `UNSUPPORTED_JOB_TYPE`, `HANDLER_ERROR`) become one closed list in `packages/contracts`, since job-service now produces some of them and job-ui may label them (user confirmed assumption)
- Re-queueing an attempt whose entry already finished removes that entry and adds it again under the same id (BullMQ ignores an add for an existing id and refuses to remove a locked one, which is the behaviour wanted); the queue port gains this operation. The loop handles jobs in bounded batches and ends its tick when the queue is unavailable instead of timing out once per job (user confirmed assumption)
- The worker tells its three abort reasons apart: a cancel or the shutdown report nothing (as today), a timeout reports `failed` with `JOB_TIMEOUT` (user confirmed assumption)
- A manual retry clears `scheduledAt` (it runs at once), so a backoff time from the previous run does not stay on a `pending` job (user confirmed assumption)
- job-ui shows `scheduledAt` only once `priority-scheduling-ui` is built; until then the next attempt's time is visible through the API only (user confirmed assumption)
- The idempotency fingerprint serialises the canonical request with `safe-stable-stringify` (91.5M weekly downloads, 3.0.0 of 2026-10-15, own types; chosen over fast-json-stable-stringify 202.8M but 2.1.0 of 2019, json-stable-stringify 19.0M, canonicalize 6.8M) and hashes it with SHA-256 from node:crypto (user)

## Assumed

- [x] A manual retry (`failed` → `pending` by a client) runs at once, without backoff - the client asked for it now; backoff is for automatic retries
- [x] A job waiting for its retry is `scheduled` for every existing rule: it can be cancelled, it counts as scheduled in the statistics, and a worker skips its entry once it is cancelled - it is the same status as a client-scheduled job
- [x] State reports from a worker carry the run and the attempt they are for; a report whose run or attempt is not the job's current one is answered with HTTP 409 `JOB_STATUS_CONFLICT` and changes nothing - otherwise a slow worker that was declared dead could complete or fail the job's next attempt, or a zombie from an earlier run the attempt of a later one
- [x] A worker whose report is refused because its attempt was recovered under it (it was only slow, e.g. its lock expired) drops the entry, sends nothing more and logs it at warn level - the job already belongs to its next attempt
- [x] A job whose result report never reached job-service runs again (at-least-once, not exactly-once); `DECISIONS.md` says so - exactly-once needs the handler's side effect and the report in one transaction, which a worker without a database cannot have
- [x] Recovery is safe with several job-service instances: each recovered job is changed with the same conditional write as every other transition, so only one instance recovers it - job-service may be scaled later
- [x] Every recovery (lost worker, re-queued waiting job) is logged at warn level with the job id and attempt - it means something went wrong
- [x] An idempotency key is a string of 1 to 255 characters; anything else answers 400 `VALIDATION_FAILED` with an issue for the key - same validation path as every other field
- [x] Two submissions with the same new key at the same time create exactly one job; both answer with that job - the uniqueness is enforced by Postgres, not by a read-then-write
- [x] A bulk answers HTTP 201 when it created at least one job and HTTP 200 when every item matched an existing job - same rule as a single submission
- [x] Two items of one bulk with the same idempotency key make the bulk answer 400 `VALIDATION_FAILED` - a bulk cannot ask for one job twice
- [x] `DECISIONS.md` section 4 is written in the retry group, section 2 in the crash-recovery group, section 1 gets the proof in the pickup group; idempotency gets its own sub-section (like scheduled jobs in section 3) - decisions are written as they are made
- [x] `docs/roadmap/05-reliability.md` marks `retry-backoff`, `concurrent-pickup`, `crash-recovery` and `idempotency` as done in `reliability` - the roadmap stays true
- [x] The idempotency key is looked up after the body's schema validation and before the time-dependent rules (departure day over, scheduled too far ahead), so a replay of a request that was valid when first sent answers 200 with the existing job instead of 400
- [x] A bulk first reads the jobs of its keys, then inserts the rest; a unique-key violation from a concurrent request restarts the read and insert, a bounded number of times, then answers 500 INTERNAL_ERROR - the uniqueness stays Postgres' and the bulk stays one insert
- [x] An idempotency key is one namespace for every client (there is no authentication to scope it); `DECISIONS.md` says so
- [x] The job error codes (`WORKER_LOST`, `JOB_TIMEOUT`, and the worker's `INVALID_PAYLOAD`, `UNSUPPORTED_JOB_TYPE`, `HANDLER_ERROR`) become one closed list in `packages/contracts`, since job-service now produces some of them and job-ui may label them
- [x] Re-queueing an attempt whose entry already finished removes that entry and adds it again under the same id (BullMQ ignores an add for an existing id and refuses to remove a locked one, which is the behaviour wanted); the queue port gains this operation. The loop handles jobs in bounded batches and ends its tick when the queue is unavailable instead of timing out once per job
- [x] The worker tells its three abort reasons apart: a cancel or the shutdown report nothing (as today), a timeout reports `failed` with `JOB_TIMEOUT`
- [x] A manual retry clears `scheduledAt` (it runs at once), so a backoff time from the previous run does not stay on a `pending` job
- [x] job-ui shows `scheduledAt` only once `priority-scheduling-ui` is built; until then the next attempt's time is visible through the API only

## Open questions

### Maximum processing time

- [x] Who enforces the maximum processing time, with which value, and what happens to a job that exceeds it?

### Retry with backoff

- [x] How does the delay grow between automatic attempts (formula and jitter)? (retry via `scheduled`; growth: see timings)
- [x] Which timings: first delay, growth factor, maximum delay?
- [x] Can a client see when the next attempt will start (a field in the job response, shown on the job page)?
- [x] Do errors that can never succeed on a retry (`INVALID_PAYLOAD`, `UNSUPPORTED_JOB_TYPE`) fail the job at once instead of using up its attempts?

### Crash recovery

- [x] How is a dead worker detected (lease renewed by a heartbeat, BullMQ's stalled detection, a fixed processing timeout)?
- [x] Which timings for dead-worker detection? (depends on the detection)
- [x] What happens to a job whose worker died: counted as a failed attempt (retry with backoff, or fail on the last attempt), and with which stored error code?
- [x] How long may a `pending` (or due `scheduled`) job wait unstarted before job-service puts it on the queue again, and how often is that checked?

### Idempotency

- [x] How does a client send the key: an `idempotencyKey` field in the job request body (works per item in a bulk) or an `Idempotency-Key` header?
- [x] What happens when a key that was already used comes with a different request (other type, payload, priority...)?
- [x] Which HTTP status answers a repeated submission: 201 like the first, or 200 to show nothing was created?
- [x] How long is a key remembered: as long as its job exists, or for a fixed window?
- [x] In a bulk, what happens to an item whose key was already used?
- [x] Does job-ui change: a key generated per submit to protect against double submits, the key on the job page, the next attempt's time on the job page?

### Proof of concurrent pickup and recovery

- [x] At which levels is it proven: an integration test with several BullMQ consumers on one real Redis, a system e2e with several workers and many jobs, a system e2e that kills a worker mid-job?
