# job-state-reporting Specification

## Purpose
Lets job-execution-service read a job and report each step of its lifecycle (start, completion,
failure) to job-service, which alone decides the resulting state, counts attempts and queues retries.

## Requirements

### Requirement: The worker can read a job
`GET /internal/v1/jobs/:id` SHALL answer HTTP 200 with the job, in the same shape as the public job
response. A well-formed id that matches no job SHALL be answered with HTTP 404 and `JOB_NOT_FOUND`.

#### Scenario: Read an existing job
- **WHEN** job-execution-service reads a job by the id of an existing job with the service token
- **THEN** the response has HTTP status 200 and the job with its type, payload, status and attempts

#### Scenario: Read an unknown job
- **WHEN** job-execution-service reads a job by a valid UUID that matches no job
- **THEN** the response has HTTP status 404 and the code `JOB_NOT_FOUND`

### Requirement: State reports go through one update route
`PATCH /internal/v1/jobs/:id` SHALL accept a body keyed by the target status: `processing` (start),
`completed` with a result that matches the job type's result schema, or `failed` with an error
`{ code, message, details? }`. An accepted report SHALL answer HTTP 200 with the updated job; a body
that matches none of these SHALL be answered with HTTP 400 and `VALIDATION_FAILED`.

#### Scenario: Unknown target status
- **WHEN** job-execution-service sends a state report with a target status other than `processing`, `completed` or `failed`
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED`, and the job is unchanged

#### Scenario: Result does not match the job type
- **WHEN** job-execution-service reports an email job `completed` with a result that has no `messageId`
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED`, and the job is unchanged

#### Scenario: Report for an unknown job
- **WHEN** job-execution-service sends a state report for a valid UUID that matches no job
- **THEN** the response has HTTP status 404 and the code `JOB_NOT_FOUND`

### Requirement: Starting a job counts an attempt
A `processing` report SHALL be accepted only for a `pending` or `scheduled` job: the job becomes
`processing`, its attempts grow by one and its started timestamp is set. For any other status it
SHALL be answered with HTTP 409 and `JOB_STATUS_CONFLICT`, with the current status in `details`.

#### Scenario: Start a pending job
- **WHEN** job-execution-service reports `processing` for a `pending` job with zero attempts
- **THEN** the response has HTTP status 200 and the job in status `processing`, with one attempt and a started timestamp

#### Scenario: Start a scheduled job
- **WHEN** job-execution-service reports `processing` for a `scheduled` job with zero attempts
- **THEN** the response has HTTP status 200 and the job in status `processing`, with one attempt, a started timestamp and its `scheduledAt` unchanged

#### Scenario: Start a job that is not pending
- **WHEN** job-execution-service reports `processing` for a job in status `processing`, `completed` or `failed`
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job is unchanged

### Requirement: Only one start wins
When several `processing` reports for the same `pending` or `scheduled` job arrive at the same time,
exactly one SHALL be accepted; every other one SHALL be answered with HTTP 409 and
`JOB_STATUS_CONFLICT`.

#### Scenario: Two workers start the same job
- **WHEN** two `processing` reports for the same `pending` job are sent at the same time
- **THEN** one answers HTTP 200, the other answers HTTP 409 with the code `JOB_STATUS_CONFLICT`, and the job has exactly one attempt

#### Scenario: Two workers start the same scheduled job
- **WHEN** two `processing` reports for the same `scheduled` job are sent at the same time
- **THEN** one answers HTTP 200, the other answers HTTP 409 with the code `JOB_STATUS_CONFLICT`, and the job has exactly one attempt

### Requirement: Completing a job stores its result
A `completed` report SHALL be accepted only for a `processing` job: the job becomes `completed`, its
result is stored, its error is cleared and its completed timestamp is set. For any other status it
SHALL be answered with HTTP 409 and `JOB_STATUS_CONFLICT`.

#### Scenario: Complete a processing job
- **WHEN** job-execution-service reports `completed` with a valid email result for a `processing` job
- **THEN** the response has HTTP status 200 and the job in status `completed` with that result and a completed timestamp

#### Scenario: Complete a job that is not processing
- **WHEN** job-execution-service reports `completed` for a job in status `pending`, `completed` or `failed`
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job is unchanged

### Requirement: A failed attempt is retried while attempts remain
A `failed` report SHALL be accepted only for a `processing` job and its error stored. While the
job's attempts are below its max attempts, the job SHALL go back to `pending` and an entry for its
next attempt SHALL be put on the job queue.

#### Scenario: Failure with attempts left
- **WHEN** job-execution-service reports `failed` with an error for a `processing` job whose attempts are below its max attempts
- **THEN** the response has HTTP status 200 and the job in status `pending` with that error and a `null` completed timestamp, and the job queue holds an entry for the job's next attempt

#### Scenario: Retry survives an unavailable queue
- **WHEN** a failure with attempts left is reported while the job queue cannot be reached
- **THEN** the response has HTTP status 200 and the job stays in status `pending` with that error

#### Scenario: Fail a job that is not processing
- **WHEN** job-execution-service reports `failed` for a job in status `pending`, `completed` or `failed`
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job is unchanged

### Requirement: A failed last attempt fails the job
When a `failed` report arrives for a `processing` job whose attempts have reached its max attempts,
the job SHALL become `failed` for good, with the error stored and its completed timestamp set, and
SHALL NOT be queued again.

#### Scenario: Failure on the last attempt
- **WHEN** job-execution-service reports `failed` with an error for a `processing` job whose attempts equal its max attempts
- **THEN** the response has HTTP status 200 and the job in status `failed` with that error and a completed timestamp, and no new entry for the job is put on the job queue
