# Proposal

## Why

The task names "Priority Queue" and "Scheduled Jobs" as two of the six critical implementation
details, its data model asks for a priority level (higher = more urgent) and an optional future
execution time, and its lifecycle has a `scheduled` status that becomes runnable "when the scheduled
time arrives". Today a job's priority is accepted and stored but does not change the order in which
jobs run, and a job cannot be given an execution time: `scheduledAt` is always `null` and no job is
ever `scheduled`. `DECISIONS.md` section 3 (Priority Queue Implementation) is still TBD.

## What Changes

- Jobs with a higher priority are picked up before waiting jobs with a lower priority.
- A client can submit a job with an optional future execution time; such a job is stored as
  `scheduled` and is not run before that time. When the time arrives, it becomes runnable and runs
  like any other job.
- The job's `scheduledAt` field shows the requested execution time.
- `DECISIONS.md` section 3 is filled in, and the scheduling approach is documented.
- job-ui is not changed here; a later change (`priority-scheduling-ui`) adds the UI.

## Capabilities

### New Capabilities
- `job-scheduling`: priority order of job pickup and running jobs at a requested future time
  (the `scheduled` status and its transition to runnable).

### Modified Capabilities
- `job-management`: submission (single and bulk) accepts an optional execution time and answers
  with a `scheduled` job; validation of that field.
- `job-state-reporting`: a `scheduled` job can be started (`scheduled` -> `processing`), with the
  same single-winner rule as a pending job.
- `job-execution`: job-execution-service runs a delivered `scheduled` job like a pending one.

## Impact

- `packages/contracts`: the create-job request gains an optional execution time.
- `apps/job-service`: creation of scheduled jobs, the queue adapter passes priority and delay,
  the start of a scheduled job.
- `apps/job-execution-service`: treats a `scheduled` job as runnable.
- `docs/roadmap/05-reliability.md`: a new `priority-scheduling-ui` change.
- `DECISIONS.md` sections 1 (ordering note) and 3.
