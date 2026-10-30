# Milestone 5: Reliability requirements

The system meets every critical implementation detail of the task, proven by tests: no job runs
twice, a crashed worker's job is recovered, failed jobs retry with backoff, higher priority runs
first, scheduled jobs wait for their time, duplicate submissions are recognised, and every step is
logged. `DECISIONS.md` sections 1–4 are filled in along the way.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `retry-backoff` | Automatic retries with backoff up to the maximum attempts; the error is stored | `webhook-job` |
| `priority-scheduling` | Higher-priority jobs run first; scheduled jobs start when their time arrives | `email-job-execution` |
| `concurrent-pickup` | Several workers never execute the same job twice | `email-job-execution` |
| `crash-recovery` | A job held by a worker that dies is recovered and finishes | `concurrent-pickup` |
| `idempotency` | Submitting with an idempotency key already used returns the existing job | `job-api` |
| `job-log` | Each lifecycle step and attempt is logged and shown in the job details | `email-job-execution` |

## Open questions

- [ ] Backoff timings and maximum attempts (recorded in `DECISIONS.md` section 4).
- [x] Batch job crash behaviour (resume vs restart). (Moot: job groups replace the batch job type, and
  each job of a group recovers like any other job; see milestone 6.)
