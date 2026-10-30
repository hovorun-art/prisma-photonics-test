# Spec Delta

## ADDED Requirements

### Requirement: A job cancelled while it runs is stopped
When job-service tells the workers that a job was cancelled, the worker running that job SHALL abort
its handler, send no further state report for it and log the stop at info level. Workers that do
not run the job SHALL ignore the cancellation. Other jobs running on the same worker SHALL go on.

#### Scenario: Running job is cancelled
- **WHEN** a worker is running a job's handler and is told that the job was cancelled
- **THEN** the handler is aborted, no `completed` or `failed` report is sent for the job, and the stop is logged at info level with the job id

#### Scenario: Cancellation of a job this worker does not run
- **WHEN** a worker is told that a job was cancelled that it does not run
- **THEN** none of its running handlers is aborted and it sends no report

#### Scenario: Other jobs keep running
- **WHEN** a worker runs two jobs and is told that one of them was cancelled
- **THEN** only that job's handler is aborted, and the other job runs to completion and is reported

### Requirement: A report refused because of a cancel is not an error
When job-service answers a worker's `completed` or `failed` report with a status conflict, the
worker SHALL drop the entry without retrying the report and log it at info level, not as an error.

#### Scenario: Completion refused after a cancel
- **WHEN** a worker reports `completed` for a job and job-service answers with a status conflict because the job was cancelled
- **THEN** the worker sends no further report for the job and logs the refusal at info level
