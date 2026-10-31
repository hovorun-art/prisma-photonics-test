# Design Decisions

The stack in one line: NestJS services in TypeScript, Postgres for job state, Redis with BullMQ for
the queue, a React UI; the services and how they talk are in the [README](README.md#architecture).
The rule behind most answers below: **Postgres decides, the queue only delivers.** BullMQ is fast at
handing out work, but every decision about a job's state is one conditional write in Postgres, made
by job-service, the only service with database access.

---

## 1. Job Pickup Strategy

**Approach chosen:** two layers. BullMQ hands each queue entry (one per attempt) to one worker at a
time through its atomic move from waiting to active. That alone is not trusted. Before running, the
worker asks job-service to start the job, naming the entry's run and attempt; job-service writes the
start as a compare-and-set (`UPDATE ... WHERE status = <what it just read> AND attempts = <what it
just read>`). One writer wins; the loser gets 409 and drops the entry without running anything.
Every later report (`completed`, `failed`) names its attempt too, so a worker that was declared lost
can never finish the attempt that replaced it.

**Why:** a queue entry is not the source of truth; the job in Postgres is. Putting the final "may I
run this?" into one conditional write makes duplicate-free execution independent of queue
behaviour, timing or the number of workers. BullMQ's own retries are off and a stalled entry is
never redelivered, so the queue never runs an entry twice by itself either.

**Trade-offs:** every job costs two extra calls to job-service before it runs (read, start), and a
job-service outage stops all progress, since workers never touch the database. In return there is
one place that decides a job's state. Proven by tests: two consumers on one real Redis run 40
entries exactly once; two simultaneous starts of one job leave one attempt; the system e2e runs 60
jobs on three workers, each exactly once.

**Idempotency (the sixth critical detail).** A submission may carry an `idempotencyKey`. The key is
unique in the jobs table, so Postgres, not a read-then-write, guarantees one job per key, also for
two simultaneous submissions. With the key we store a fingerprint of the request: the same key with
the same request answers 200 with the existing job; the same key with a different request answers
409 `IDEMPOTENCY_KEY_CONFLICT`, because silently returning another job would hide a client bug.
*Trade-off:* keys are one namespace for all clients (there is no authentication to scope them), and
a key stays taken for as long as its job exists.

---

## 2. Worker Crash Recovery

**Approach chosen:** no heartbeat of our own. BullMQ's lock on an active entry is the worker's
liveness signal: a living worker renews it, and an entry whose lock expired is taken out of
`active` and never run again. job-service then **reconciles Postgres with the queue** in a recovery
pass every 30 s:
- a `processing` job whose entry is no longer held fails its attempt with `WORKER_LOST`;
- a `processing` job running longer than its type's time limit fails its attempt with `JOB_TIMEOUT`;
- a `pending` job, or a `scheduled` one whose time has passed, with no entry on the queue is queued
  again (an enqueue that failed, or Redis that lost its data).

A failed attempt goes through the same rule as a worker's own failure report: retried with backoff
while attempts remain (section 4), failed for good otherwise. The write is conditional, so if a
worker's report arrives first, it wins.

**Why:** the worker changes state only through job-service, so it holds nothing worth saving; what
a crash loses is the attempt it was running, and Postgres knows that attempt. One comparison of
Postgres with the queue covers every way a job gets stuck: a killed worker, a shutdown past its
grace period, a report that never arrived, a failed enqueue, lost Redis data.

**What happens if a worker crashes mid-job:** its lock stops being renewed; another worker's stalled
check takes the entry out of `active`, and the next recovery pass fails the attempt with
`WORKER_LOST`, about one to one and a half minutes after the crash with the default timings. The job is retried after its backoff delay on a living worker. The
attempt was counted when it started, so a job that crashes its worker every time uses up its
attempts and fails instead of looping. The system e2e kills one of three workers with `docker kill`
mid-run: every job completes, the lost ones on a second attempt.

**Trade-offs:** at-least-once, not exactly-once. A worker that was only slow, or whose result never
reached job-service, has its attempt failed and the job runs again; its late report is refused.
Exactly-once would need the side effect and the report in one transaction, which a worker without a
database cannot have, so handlers that touch the outside world should be idempotent. With every
worker down, only the time limit recovers a running job.

---

## 3. Priority Queue Implementation

**Approach chosen:** BullMQ's own priority, set on every entry. Our scale is 1–10, higher = more
urgent; BullMQ's runs the other way, so the adapter maps it as `11 - priority`. Every entry gets a
priority, the default included, because BullMQ hands out entries without one before all prioritised
ones: one entry without a priority would jump the whole queue. Within a priority, first in, first
out. A retry keeps the job's priority.

**Why:** pickup is BullMQ's atomic move (section 1), so ordering has to happen in the same place; a
priority kept anywhere else would be read only after BullMQ had already chosen an entry.

**Trade-offs:** strict priority without ageing: a steady stream of urgent jobs starves the rest for
as long as it lasts. *Alternatives:* one queue per priority level (more of our own logic, up to ten
round trips per pickup), or ordering in Postgres with `FOR UPDATE SKIP LOCKED` (a different pickup
design altogether).

**Scheduled jobs (the fifth critical detail).** A job with a future `scheduledAt` is stored as
`scheduled`, and its entry is a BullMQ *delayed* entry; when it is due, it competes by priority
like any other and starts straight from `scheduled`. At most 30 days ahead, so a typo cannot park
an entry for years. *Trade-off:* the schedule lives in Redis; if Redis loses it, the recovery pass
queues the job again from Postgres once its time has passed.

---

## 4. Retry Backoff Strategy

**Approach chosen:** **a retry is a scheduled job.** When an attempt fails and attempts remain
(a worker's failure, `WORKER_LOST` or `JOB_TIMEOUT`: one rule for all), job-service stores the error
and sets the job to `scheduled` with `scheduledAt` = now + the backoff delay, and its next entry
goes on the queue as a delayed entry. So there is no separate retry status, retry loop or retry
timer: a client sees when the next attempt starts, the job counts as scheduled in the statistics,
it can be cancelled like any scheduled job, and the recovery pass already covers a retry whose
entry was lost. BullMQ's own retry options stay off. A manual retry of a failed job runs at once.

**Timing:** exponential backoff with jitter. Retry *n* waits a random time between
5 s × 2^(n−1) and 30 s × 2^(n−1), each bound capped at 5 minutes: retry 1 waits 5–30 s, retry 2
10–60 s, retry 3 20–120 s, and so on up to 5 minutes. With the default of 3 attempts a job is
retried at most twice. All three numbers are configuration. The range grows so a failing dependency
gets more room each time, and the randomness keeps jobs that failed together (an outage) from
coming back at the same instant.

---

## 5. One Thing I Would Do Differently With More Time

**Events instead of polling, between services and to the client.** job-group-service learns about
its groups by asking job-service every 2 s: three count queries per open group per tick, and since a
retry can reopen a failed group, a failed group nobody retries is polled forever. The UI does the
same: every open page asks job-service again every 2 s, whether anything changed or not. With many
groups and open pages the system spends its time answering questions about nothing; we are, in
effect, DDoSing ourselves. I would have job-service publish job status changes (a Redis Stream, as
job log entries already travel, or a real broker): job-group-service would update a group when one
of its jobs changes, and the UI would receive the changes it shows through Server-Sent Events
instead of asking. The price is what polling gets for free: at-least-once delivery with idempotent
updates, replaying missed events after a restart or a dropped connection, and keeping a connection
open per page.

Two smaller ones, said plainly:

- **Own services for what now lives inside job-service.** The job log and the queue statistics run
  inside job-service to save scaffolding more services. I would give them their own services with
  their own APIs and storage.
- **A lighter, step-by-step verification flow.** The spec-driven flow (decisions, specs, a test
  review per task group, a verifier at the end of a change) caught real gaps, but one heavy
  verification pass at the end cost a lot of time. I would check and save progress per task group,
  and scale the ceremony to the size of the change.

---

## Other Trade-offs

- **BullMQ behind our own queue interface.** BullMQ does the low-level mechanics (atomic pickup,
  locks, priority, delays); it sits behind a small interface of ours, so it could be replaced. What
  we own: keeping Postgres and the queue in sync, the lifecycle, idempotency, the races and the
  recovery. *Alternatives:* a Postgres-only queue with `SKIP LOCKED` (one store, no dual write, but
  polling load on the database), RabbitMQ (delays need plugins), a custom Redis queue in Lua (most
  low-level code, most bugs).
- **One owner of job state, no shared database.** The worker is a separate service that reads and
  changes jobs only through job-service's internal API (with a service token). Two services writing
  one table would couple their schemas and let the job's rules be bypassed. *Cost:* an HTTP hop per
  state change.
- **A failed enqueue leaves the job pending, not the request failed.** A job is stored first, then
  queued; if Redis is down, the submit still succeeds and the recovery pass queues the job later.
  *Better, not built:* a transactional outbox, which closes the window in which a job is stored but
  not queued.
- **Cancelling a running job,** beyond what the task asks: job-service writes `cancelled`, then
  announces it on a Redis pub/sub channel, and the worker running the job aborts it. Pub/sub is fire
  and forget; a worker that misses the message runs the job to its end, and its report is refused
  because the job is no longer running. The job stays cancelled; only the work is wasted.
- **Job groups instead of a Batch job type.** A batch is many ordinary jobs submitted at once with a
  shared `groupId`, followed as one group by job-group-service. Each item gets the system's pickup,
  retries, priority and recovery, instead of a second, smaller job system inside one job. *Said
  plainly:* there is no `batch` type, and the Job's progress percentage from the task's data model
  is unused; a group's progress comes from its jobs' statuses.
- **Job log in ClickHouse.** Logs are append-only, written far more than read and removed by age, so
  they go through a Redis Stream into ClickHouse, in batches; writing a log entry never blocks or
  fails a job. *Honestly:* at this task's volume a Postgres table would do; ClickHouse shows how the
  log would scale, at the cost of one more container.
- **Health checks report only their own process.** If `/health` included other services, services
  that wait for each other's health could deadlock at startup. A down database shows up as errors on
  the requests that need it, not on `/health`.
- **REST + OpenAPI with shared Zod schemas, not tRPC.** Other services must be able to call the API;
  the same schemas validate requests, generate the API docs and type the UI, so they cannot drift.
- **Simulated work.** Emails and webhooks are never sent; the handlers sleep, and webhook and
  transit jobs fail at a configured rate to exercise retries. Transit reports are generated from a
  bundled airport list, with no external API.
