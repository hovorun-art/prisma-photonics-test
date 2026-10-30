# Decisions: job-status-change

## Decided

- One change for cancel and retry, in job-service, job-execution-service and job-ui; it replaces the
  roadmap's `job-cancel` and `job-retry` changes (user)
- Cancel stops the job's work: a running job is stopped, not only marked (user)
- Retry only sets the job back to `pending` and resets its attempts to zero (user)
- Retry puts the job on the job queue again (user)
- Cancel is allowed from `pending`, `scheduled` and `processing`; a waiting job is never run, a running job is stopped by its worker (user)
- Retry is allowed only from `failed` (user)
- Public API: `PATCH /v1/jobs/:id` with `{ "status": "cancelled" }` (cancel) or `{ "status": "pending" }` (retry), answering HTTP 200 with the job; any other target status answers 400 `VALIDATION_FAILED` (user)
- A running job learns of its cancellation through Redis pub/sub behind our queue interface (its `cancel`): job-service publishes, every worker listens and aborts the handler if it runs that job; a late result report is answered with a conflict as a safety net (user)
- One system e2e scenario each: cancel a job from the job page and see it `cancelled`; retry a failed job and see it run again (user)
- Retry clears the job's error, result, started and completed timestamps, so the job looks like a newly submitted one apart from its id and created time (user confirmed assumption)
- Cancel sets the completed timestamp (the time the job finished) and keeps the error and result as they were (user confirmed assumption)
- Cancelling or retrying a job whose status does not allow it answers HTTP 409 `JOB_STATUS_CONFLICT` with the current status in `details`, also for a job already in the target status (no silent no-op); an unknown job answers 404 `JOB_NOT_FOUND` (user confirmed assumption)
- When the queue cannot be reached during a retry, the retry still answers HTTP 200 and the job stays `pending` (user confirmed assumption)
- A report from a worker for a job that was cancelled (`completed`, `failed`) answers 409 `JOB_STATUS_CONFLICT` and the job stays `cancelled`; the worker treats that as a lost race and logs it at info level (user confirmed assumption)
- A cancelled waiting job's queue entry is left on the queue and skipped by the worker, as for any job that is not `pending` (user confirmed assumption)
- On the job page, Cancel opens a confirmation dialog (like Delete); Retry runs at once without a dialog (user confirmed assumption)
- After a successful cancel or retry the job page shows the updated job at once (no wait for the next poll); a failed request is shown as an error toast/message with the API error's message, and the job stays as it was (user confirmed assumption)
- A worker whose handler was aborted because the job was cancelled sends no report for it and logs the stop at info level (user confirmed assumption)
- Buttons are only on the job page, not as row actions on the jobs list (user confirmed assumption)
- Cancel and Retry buttons are disabled while their request is in flight (user confirmed assumption)

## Assumed

- [x] Retry clears the job's error, result, started and completed timestamps, so the job looks like a newly submitted one apart from its id and created time - the user asked for a plain reset
- [x] Cancel sets the completed timestamp (the time the job finished) and keeps the error and result as they were - `cancelled` is a final status like `completed` and `failed`
- [x] Cancelling or retrying a job whose status does not allow it answers HTTP 409 `JOB_STATUS_CONFLICT` with the current status in `details`, also for a job already in the target status (no silent no-op); an unknown job answers 404 `JOB_NOT_FOUND` - same as delete
- [x] When the queue cannot be reached during a retry, the retry still answers HTTP 200 and the job stays `pending` - same as submit
- [x] A report from a worker for a job that was cancelled (`completed`, `failed`) answers 409 `JOB_STATUS_CONFLICT` and the job stays `cancelled`; the worker treats that as a lost race and logs it at info level - cancel wins over a late result
- [x] A cancelled waiting job's queue entry is left on the queue and skipped by the worker, as for any job that is not `pending` - the worker already does this
- [x] On the job page, Cancel opens a confirmation dialog (like Delete); Retry runs at once without a dialog - cancelling a running job loses its work, retrying loses nothing
- [x] After a successful cancel or retry the job page shows the updated job at once (no wait for the next poll); a failed request is shown as an error toast/message with the API error's message, and the job stays as it was - matches how Delete reports errors
- [x] A worker whose handler was aborted because the job was cancelled sends no report for it and logs the stop at info level - the job is already final
- [x] Buttons are only on the job page, not as row actions on the jobs list - the buttons already exist there in the design
- [x] Cancel and Retry buttons are disabled while their request is in flight - avoids double submits

## Open questions

- [x] Which statuses can be cancelled?
- [x] Which statuses can be retried?
- [x] What does the public API look like (route and body)?
- [x] How does the worker running a job learn that it was cancelled?
- [x] Is a cancel/retry scenario added to the system e2e?
