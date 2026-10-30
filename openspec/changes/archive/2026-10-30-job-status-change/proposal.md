# Proposal

## Why

The task's API asks for cancelling a job and retrying a failed one, and the job page in job-ui
already shows Cancel and Retry buttons, disabled as "coming soon". Users have no way to stop a job
they no longer want or to run again a job that failed for good. This change makes both actions work
end to end, in job-service and in job-ui. It merges the roadmap's `job-cancel` and `job-retry`
changes into one.

## What Changes

- A public way for clients to change a job's status in job-service, for two actions:
  - **Cancel**: the job becomes `cancelled` and its work stops: a waiting job is never run, and a
    running job is stopped by the worker that runs it.
  - **Retry**: the job goes back to `pending` with its attempts reset to zero, and is put on the
    job queue again, so it runs as a new job would.
- Cancelling or retrying a job in a status that does not allow it is rejected with a status
  conflict.
- job-execution-service stops a job that is cancelled while it runs, and does not report it as
  completed or failed afterwards.
- job-ui: the Cancel and Retry buttons on the job page work (no longer "coming soon"), with the
  result and any error shown to the user.

Which statuses allow each action, the exact route and body, what happens to the error and result
fields, and how the UI confirms the actions are open points in `decisions.md`.

## Capabilities

### New Capabilities
- `job-status-change`: clients cancel or retry a job through the public API; the allowed statuses,
  the resulting job state, re-queueing on retry and the error answers.

### Modified Capabilities
- `job-execution`: a job cancelled while it runs is stopped, and a job cancelled while it waits is
  not run.
- `job-state-reporting`: reports from the worker for a cancelled job are answered with a conflict
  and do not change it.
- `job-ui`: the job page's Cancel and Retry buttons work instead of being shown as coming soon.
- `job-management`: the job routes' documentation lists the new route.

## Impact

- `packages/contracts`: request schema for the status change and the route constant.
- `apps/job-service`: a new public route and use-case method; re-queueing an attempt that was
  queued before (the queue skips an attempt already queued); telling running workers about a
  cancellation; OpenAPI docs.
- `apps/job-execution-service`: noticing a cancellation of the job it runs and aborting the
  handler through its existing abort signal.
- `apps/job-ui`: API call, hooks and buttons on the job page, locale strings.
- `DECISIONS.md`: how cancellation reaches a running worker and how retry interacts with the queue.
- Tests at every level, including the system e2e.
