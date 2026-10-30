# Decisions: priority-scheduling

## Decided

- Priority and scheduled jobs are both required by the task (data model, critical details #4 and
  #5, lifecycle diagram) and are built together in this change. (user)
- Priority uses BullMQ's native priority: the job's priority is passed to the queue entry, mapped so our highest (10) is BullMQ's most urgent (1). (user)
- Scheduled jobs are released through BullMQ delayed entries: at submission the entry is queued with delay = `scheduledAt` minus now; the job stays `scheduled` until a worker starts it (`scheduled` -> `processing` directly, as the task's lifecycle allows). (user)
- A `scheduledAt` that is now or in the past runs the job immediately: it is created `pending` and queued at once, `scheduledAt` stored as given. (user)
- `scheduledAt` may be at most a configured time ahead (30 days, held in the shared job contract limits); a later time is rejected with HTTP 400 `VALIDATION_FAILED` and an issue on `scheduledAt`. (user)
- job-ui is not part of this change; a separate later change enables "At a specific time" and shows the scheduled time. (user)
- Jobs of equal priority run in submission order (FIFO). (user confirmed assumption)
- Strict priority without ageing: under constant high-priority load lower-priority jobs wait; recorded as a trade-off in `DECISIONS.md` section 3. (user confirmed assumption)
- Automatic retries keep the job's priority. (user confirmed assumption)
- Bulk submission accepts the execution time per item, the same as a single submission. (user confirmed assumption)
- The request field is `scheduledAt`, an ISO 8601 timestamp with a time zone offset; the job's existing `scheduledAt` field echoes it. (user confirmed assumption)
- Changing priority or execution time after submission and cancelling a scheduled job stay out of scope (roadmap changes `job-update` and `job-cancel`). (user confirmed assumption)
- job-service accepts the `processing` report for a `scheduled` job as for a `pending` one, without checking the time again; job-execution-service treats `scheduled` like `pending` when it reads the job for an entry. (user confirmed assumption)
- A scheduled job whose entry could not be queued at submission stays `scheduled` and is logged, like a pending one today; picking it up again belongs to the recovery sweep in `crash-recovery`. (user confirmed assumption)
- Add a `priority-scheduling-ui` change to the roadmap (milestone 5) for the UI part. (user confirmed assumption)
- The queue statistics need no change: they already count `scheduled` jobs. (user confirmed assumption)

## Assumed

- [x] Jobs of equal priority run in submission order (FIFO) - the natural tie-break and what the queue does today.
- [x] Strict priority without ageing: under constant high-priority load lower-priority jobs wait; recorded as a trade-off in `DECISIONS.md` section 3 - the task asks for "higher = more urgent", nothing more.
- [x] Automatic retries keep the job's priority - a retry is the same job.
- [x] Bulk submission accepts the execution time per item, the same as a single submission - bulk items use the single create schema.
- [x] The request field is `scheduledAt`, an ISO 8601 timestamp with a time zone offset; the job's existing `scheduledAt` field echoes it - the field already exists on the Job entity.
- [x] Changing priority or execution time after submission and cancelling a scheduled job stay out of scope (roadmap changes `job-update` and `job-cancel`) - keeps this change focused.
- [x] job-service accepts the `processing` report for a `scheduled` job as for a `pending` one, without checking the time again; job-execution-service treats `scheduled` like `pending` when it reads the job for an entry - the delay is enforced by the queue, and a second time check could drop a due entry over a few ms of clock skew and leave the job stuck.
- [x] A scheduled job whose entry could not be queued at submission stays `scheduled` and is logged, like a pending one today; picking it up again belongs to the recovery sweep in `crash-recovery` - same rule as the existing "submission survives an unavailable queue".
- [x] Add a `priority-scheduling-ui` change to the roadmap (milestone 5) for the UI part - follows from the UI scope decision.
- [x] The queue statistics need no change: they already count `scheduled` jobs - already in the `queue-statistics` spec.

## Open questions

- [x] How are scheduled jobs released when their time arrives?
- [x] What happens when `scheduledAt` is now or in the past?
- [x] Is there a limit on how far ahead a job may be scheduled?
- [x] Is the job-ui part ("At a specific time" on the submit page, scheduled time on the job) in this change?
- [x] How is priority implemented on the queue?
