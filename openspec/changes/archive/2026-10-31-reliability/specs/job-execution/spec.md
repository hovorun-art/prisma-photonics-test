# Spec Delta

## ADDED Requirements

### Requirement: State reports name the run and attempt
Every state report job-execution-service sends for an entry SHALL carry the run and the attempt
of that entry.

#### Scenario: Reports of one entry
- **WHEN** a worker runs an entry for a job's second attempt in its first run
- **THEN** its `processing` and `completed` (or `failed`) reports carry run one and attempt two

### Requirement: A handler is stopped at the job's maximum processing time
When a handler has run for the job's maximum processing time (read with the job from job-service)
without finishing, the worker SHALL abort it and report the job `failed` with the error code
`JOB_TIMEOUT`.

#### Scenario: Handler exceeds the time limit
- **WHEN** a handler runs longer than the job's maximum processing time
- **THEN** the handler's abort signal fires and the worker reports `failed` with code `JOB_TIMEOUT`

#### Scenario: Handler within the time limit
- **WHEN** a handler finishes before the job's maximum processing time
- **THEN** the worker reports `completed` with its result and no `JOB_TIMEOUT` is reported

### Requirement: A report refused because the attempt was recovered is dropped with a warning
When job-service answers a worker's `completed` or `failed` report with a status conflict whose
current status is not `cancelled`, the worker SHALL drop the entry, send nothing more for it and
log the refusal at warn level with the job id and attempt: the job was recovered under this
worker.

#### Scenario: Completion refused after a recovery
- **WHEN** a worker reports `completed` for an attempt that job-service already recovered as a lost worker
- **THEN** the worker sends no further report for the job and logs the refusal at warn level with the job id and attempt

### Requirement: Several worker instances never run one job twice
When several job-execution-service instances take from the same job queue, each queued entry SHALL
be handed to exactly one of them, and each job SHALL be run once per attempt.

#### Scenario: Each entry goes to one consumer
- **WHEN** several consumers take from one job queue on which many entries were queued
- **THEN** every entry is handed to exactly one consumer and no entry is handed to two

#### Scenario: Many jobs on several instances complete once each
- **WHEN** many jobs are submitted on the full system with several job-execution-service instances
- **THEN** every job reaches `completed` with exactly one attempt

## MODIFIED Requirements

### Requirement: The queue does not retry entries by itself
A queue entry SHALL be taken once; retries happen only as new entries that job-service queues for
the next attempt. An entry whose worker stopped renewing its lease SHALL NOT be run by another
worker: the queue marks it failed, and job-service recovers the job.

#### Scenario: Failed attempt is not redelivered
- **WHEN** handling an entry ends with a failure report
- **THEN** the queue does not deliver that entry again

#### Scenario: Stalled entry is not run again
- **WHEN** a worker holding an entry stops renewing its lease and another worker takes from the same queue
- **THEN** the other worker does not run that entry, and the queue marks it failed

### Requirement: Running jobs finish on shutdown
On a termination signal, job-execution-service SHALL stop taking new entries and let running jobs
finish and report, for at most the configured grace period, before it exits.

#### Scenario: Job running during shutdown
- **WHEN** job-execution-service receives a termination signal while a job is running
- **THEN** it takes no new entries, the running job finishes and is reported, and then the process exits

#### Scenario: Grace period runs out
- **WHEN** a running job has not finished when the configured grace period ends
- **THEN** the process exits without reporting it, and the job stays `processing` until job-service's recovery pass treats it as a lost worker

### Requirement: A job cancelled while it runs is stopped
When job-service tells the workers that a job was cancelled, the worker running that job SHALL abort
its handler, send no further state report for it and log the stop at info level. Workers that do
not run the job SHALL ignore the cancellation. Other jobs running on the same worker SHALL go on.
A stop by a cancel or by the shutdown reports nothing; only a stop at the maximum processing time
is reported, as `JOB_TIMEOUT`.

#### Scenario: Running job is cancelled
- **WHEN** a worker is running a job's handler and is told that the job was cancelled
- **THEN** the handler is aborted, no `completed` or `failed` report is sent for the job, and the stop is logged at info level with the job id

#### Scenario: Cancellation of a job this worker does not run
- **WHEN** a worker is told that a job was cancelled that it does not run
- **THEN** none of its running handlers is aborted and it sends no report

#### Scenario: Other jobs keep running
- **WHEN** a worker runs two jobs and is told that one of them was cancelled
- **THEN** only that job's handler is aborted, and the other job runs to completion and is reported

#### Scenario: Cancel and timeout are told apart
- **WHEN** a job is cancelled while its handler runs
- **THEN** no `JOB_TIMEOUT` failure is reported for it
