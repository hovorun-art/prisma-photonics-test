# Spec Delta

## MODIFIED Requirements

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
