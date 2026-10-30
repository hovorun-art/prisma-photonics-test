# Spec Delta

## Purpose

Defines how job-execution-service takes queued jobs, runs them with the handler of their type and
reports every outcome to job-service, including the cases where a job must not or cannot run.

## ADDED Requirements

### Requirement: Queued pending jobs are run and reported
For each queue entry, job-execution-service SHALL read the job from job-service, report it
`processing`, run the handler of the job's type and report `completed` with the handler's result.

#### Scenario: Pending job runs to completion
- **WHEN** an entry is queued for a pending email job
- **THEN** job-execution-service reports the job `processing`, runs the email handler and reports it `completed` with the handler's result

#### Scenario: Submitted email job completes end to end
- **WHEN** a client submits an email job to job-service on the full system
- **THEN** getting the job later shows status `completed` with a result that has a message id

### Requirement: Jobs that are no longer runnable are skipped
When the job read for an entry is not `pending`, or no longer exists, job-execution-service SHALL
drop the entry without running a handler and without reporting anything.

#### Scenario: Job already taken or finished
- **WHEN** an entry is queued for a job whose status is `processing`, `completed`, `failed` or `cancelled`
- **THEN** no handler runs and no state report is sent for it

#### Scenario: Job deleted
- **WHEN** an entry is queued for a job that job-service no longer has
- **THEN** no handler runs and no state report is sent for it

### Requirement: A lost start is not an error
When job-service answers the `processing` report with a status conflict or not found, the worker
SHALL drop the entry without running the handler and log it at info level, not as an error.

#### Scenario: Another worker started the job first
- **WHEN** job-service answers a worker's `processing` report with a status conflict
- **THEN** that worker does not run the handler, sends no further report and logs the skip at info level

### Requirement: Jobs that cannot run are reported as failed
job-execution-service SHALL report `failed` with an error code when a job cannot run:
`INVALID_PAYLOAD` when the job does not match the shared job contract, `UNSUPPORTED_JOB_TYPE` when
no handler exists for its type.

#### Scenario: Invalid payload
- **WHEN** an entry is queued for a pending job whose payload does not match the job contract
- **THEN** job-execution-service reports the job `failed` with error code `INVALID_PAYLOAD` and runs no handler

#### Scenario: No handler for the type
- **WHEN** an entry is queued for a pending job whose type has no handler in this worker
- **THEN** job-execution-service reports the job `failed` with error code `UNSUPPORTED_JOB_TYPE`

### Requirement: Handler errors are reported as failed
When a handler throws, job-execution-service SHALL report the job `failed` with the error's code
and message, or with code `HANDLER_ERROR` when the error has no code of its own.

#### Scenario: Handler throws a coded error
- **WHEN** the handler of a processing job throws an error with a code
- **THEN** job-execution-service reports the job `failed` with that code and the error's message

#### Scenario: Handler throws an unexpected error
- **WHEN** the handler of a processing job throws an error without a code
- **THEN** job-execution-service reports the job `failed` with code `HANDLER_ERROR`

### Requirement: Failed reports are retried, then given up
When a state report cannot reach job-service, job-execution-service SHALL retry it the configured
number of times, waiting longer before each try (from the configured delay up to the configured
maximum, varied at random so workers do not retry together); when every try fails, it SHALL log an error with the job
id and drop the entry.

#### Scenario: Report succeeds after a retry
- **WHEN** a state report fails once and job-service answers the next try
- **THEN** the report is delivered and the job continues normally

#### Scenario: Report keeps failing
- **WHEN** every try of a state report fails
- **THEN** job-execution-service logs an error with the job id and drops the entry, and the job keeps the state job-service last accepted

### Requirement: The queue does not retry entries by itself
A queue entry SHALL be taken once; retries happen only as new entries that job-service queues for
the next attempt.

#### Scenario: Failed attempt is not redelivered
- **WHEN** handling an entry ends with a failure report
- **THEN** the queue does not deliver that entry again

### Requirement: An instance runs several jobs at once
One job-execution-service instance SHALL run up to the configured number of jobs at the same time.

#### Scenario: Concurrent jobs within one instance
- **WHEN** more entries are queued than the configured concurrency and their handlers take a while
- **THEN** one instance runs as many jobs at the same time as the configured concurrency, and no more

### Requirement: Running jobs finish on shutdown
On a termination signal, job-execution-service SHALL stop taking new entries and let running jobs
finish and report, for at most the configured grace period, before it exits.

#### Scenario: Job running during shutdown
- **WHEN** job-execution-service receives a termination signal while a job is running
- **THEN** it takes no new entries, the running job finishes and is reported, and then the process exits

#### Scenario: Grace period runs out
- **WHEN** a running job has not finished when the configured grace period ends
- **THEN** the process exits without reporting it, and the job stays `processing`

### Requirement: Job log lines identify the job and the worker
Every log line job-execution-service writes about a job SHALL carry the job id, the attempt and the
worker instance id.

#### Scenario: Logs of a completed job
- **WHEN** a job runs to completion
- **THEN** each log line about it has the job id, the attempt and the instance id
