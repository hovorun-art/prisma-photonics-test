# Spec Delta

## ADDED Requirements

### Requirement: The worker's job read carries the maximum processing time
The job read by `GET /internal/v1/jobs/:id` SHALL include the maximum processing time of the job's
type, as configured in job-service, so a worker uses the same limit as job-service.

#### Scenario: Read a job with its time limit
- **WHEN** job-execution-service reads an email job with the service token
- **THEN** the response has HTTP status 200, the job, and the configured maximum processing time of email jobs

### Requirement: Reports for an attempt that is not the job's current one are refused
A state report whose run or attempt is not the job's current run and attempt SHALL be answered
with HTTP 409 and `JOB_STATUS_CONFLICT` with the current status in `details`, and the job is
unchanged. This covers a worker whose attempt was recovered under it and a worker from an earlier
run.

#### Scenario: Completion of a recovered attempt
- **WHEN** a job's attempt was recovered as a lost worker and the job is `processing` in its next attempt, and the lost worker reports `completed` for the earlier attempt
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job keeps its current attempt without a result

#### Scenario: Failure from an earlier run
- **WHEN** a job was retried by hand and is `processing` in its new run, and a worker reports `failed` with the earlier run's numbers
- **THEN** the response has HTTP status 409 and the code `JOB_STATUS_CONFLICT`, and the job is unchanged

#### Scenario: Start for a stale attempt
- **WHEN** a worker reports `processing` for a `scheduled` job with an attempt number other than the job's attempts plus one
- **THEN** the response has HTTP status 409 and the code `JOB_STATUS_CONFLICT`, and the job's attempts are unchanged

### Requirement: Every failure is retried while attempts remain
A `failed` report with attempts left SHALL schedule the next attempt whatever the error code,
including `INVALID_PAYLOAD` and `UNSUPPORTED_JOB_TYPE`, since the failure may come from a worker
that does not know a newer payload or type yet.

#### Scenario: Invalid payload with attempts left
- **WHEN** job-execution-service reports `failed` with code `INVALID_PAYLOAD` for a `processing` job whose attempts are below its max attempts
- **THEN** the job is `scheduled` for its next attempt with that error

## MODIFIED Requirements

### Requirement: State reports go through one update route
`PATCH /internal/v1/jobs/:id` SHALL accept a body keyed by the target status: `processing` (start),
`completed` with a result that matches the job type's result schema, or `failed` with an error
`{ code, message, details? }`. Every report SHALL also carry the `run` and `attempt` it is for. An
accepted report SHALL answer HTTP 200 with the updated job; a body that matches none of these, or
without run and attempt, SHALL be answered with HTTP 400 and `VALIDATION_FAILED`.

#### Scenario: Unknown target status
- **WHEN** job-execution-service sends a state report with a target status other than `processing`, `completed` or `failed`
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED`, and the job is unchanged

#### Scenario: Report without run and attempt
- **WHEN** job-execution-service sends a `processing` report without `run` and `attempt`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and issues for the `run` and `attempt` fields, and the job is unchanged

#### Scenario: Result does not match the job type
- **WHEN** job-execution-service reports an email job `completed` with a result that has no `messageId`
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED`, and the job is unchanged

#### Scenario: Report for an unknown job
- **WHEN** job-execution-service sends a state report for a valid UUID that matches no job
- **THEN** the response has HTTP status 404 and the code `JOB_NOT_FOUND`

### Requirement: Starting a job counts an attempt
A `processing` report SHALL be accepted for a `pending` or `scheduled` job when its run is the
job's current run and its attempt is the job's attempts plus one: the job becomes `processing`, its
attempts grow by one and its started timestamp is set. A `processing` report for a job that is
already `processing` in that same run and attempt SHALL be answered with HTTP 200 and the job
unchanged, since only the worker that started the attempt can repeat its start. For any other
status it SHALL be answered with HTTP 409 and `JOB_STATUS_CONFLICT`, with the current status in
`details`.

#### Scenario: Start a pending job
- **WHEN** job-execution-service reports `processing` for a `pending` job with zero attempts, with the job's run and attempt one
- **THEN** the response has HTTP status 200 and the job in status `processing`, with one attempt and a started timestamp

#### Scenario: Start a scheduled job
- **WHEN** job-execution-service reports `processing` for a `scheduled` job with zero attempts
- **THEN** the response has HTTP status 200 and the job in status `processing`, with one attempt, a started timestamp and its `scheduledAt` unchanged

#### Scenario: Repeated start of the same attempt
- **WHEN** job-execution-service reports `processing` for a job that is `processing` in that run and attempt
- **THEN** the response has HTTP status 200 and the job unchanged, with the same attempts and started timestamp

#### Scenario: Start a job that is not pending
- **WHEN** job-execution-service reports `processing` for a job in status `completed` or `failed`, or for a `processing` job with another attempt number
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job is unchanged

### Requirement: Only one start wins
When several `processing` reports for the same `pending` or `scheduled` job arrive at the same
time, the attempt SHALL be counted exactly once: reports for the same run and attempt all answer
HTTP 200 with the started job, and a report for another attempt is answered with HTTP 409 and
`JOB_STATUS_CONFLICT`.

#### Scenario: Two workers start the same job
- **WHEN** two `processing` reports for the same `pending` job with the same run and attempt are sent at the same time
- **THEN** both answer HTTP 200 with the job in status `processing`, and the job has exactly one attempt and one started timestamp

#### Scenario: Two workers start the same scheduled job
- **WHEN** two `processing` reports for the same `scheduled` job with the same run and attempt are sent at the same time
- **THEN** both answer HTTP 200, and the job has exactly one attempt

### Requirement: A failed attempt is retried while attempts remain
A `failed` report SHALL be accepted only for a `processing` job in the reported run and attempt,
and its error stored. While the job's attempts are below its max attempts, the job SHALL become
`scheduled` with `scheduledAt` set to the time of the report plus a retry delay, and an entry for
its next attempt SHALL be put on the job queue with the job's priority, not available to workers
before that time. The delay is drawn at random from the configured range for the first retry;
the range doubles with each further retry up to the configured maximum delay.

#### Scenario: Failure with attempts left
- **WHEN** job-execution-service reports `failed` with an error for a `processing` job whose attempts are below its max attempts
- **THEN** the response has HTTP status 200 and the job in status `scheduled` with that error, a `null` completed timestamp and a `scheduledAt` later than the report by a delay within the configured range of the first retry, and the job queue holds an entry for the job's next attempt that is not available before that `scheduledAt`

#### Scenario: Delay grows with each retry
- **WHEN** job-execution-service reports the second failed attempt of a job with attempts left
- **THEN** the job's new `scheduledAt` lies later than the report by a delay within twice the configured range of the first retry

#### Scenario: Delay is capped
- **WHEN** job-execution-service reports a failed attempt whose doubled range would exceed the configured maximum delay
- **THEN** the job's new `scheduledAt` lies no later than the report plus the configured maximum delay

#### Scenario: Retry survives an unavailable queue
- **WHEN** a failure with attempts left is reported while the job queue cannot be reached
- **THEN** the response has HTTP status 200 and the job stays in status `scheduled` with that error

#### Scenario: Fail a job that is not processing
- **WHEN** job-execution-service reports `failed` for a job in status `pending`, `completed` or `failed`
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job is unchanged
