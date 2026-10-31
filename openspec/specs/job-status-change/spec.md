# job-status-change Specification

## Purpose
Lets API clients change a job's status by hand: cancel a job that has not finished, so its work
stops, or retry a failed job, so it runs again from its first attempt.

## Requirements

### Requirement: Clients change a job's status through one route
`PATCH /v1/jobs/:id` SHALL accept a body `{ "status": "cancelled" }` (cancel) or
`{ "status": "pending" }` (retry) and answer HTTP 200 with the updated job. A body with any other
status, or without one, SHALL be answered with HTTP 400 and `VALIDATION_FAILED` with an issue for
the `status` field, and the job is unchanged.

#### Scenario: Unsupported target status
- **WHEN** a client sends `PATCH /v1/jobs/:id` with `{ "status": "completed" }` for an existing job
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `status` field, and the job is unchanged

#### Scenario: Missing status
- **WHEN** a client sends `PATCH /v1/jobs/:id` with an empty object for an existing job
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `status` field, and the job is unchanged

#### Scenario: Status change for an unknown job
- **WHEN** a client sends `PATCH /v1/jobs/:id` with `{ "status": "cancelled" }` for a valid UUID that matches no job
- **THEN** the response has HTTP status 404 and the code `JOB_NOT_FOUND`

#### Scenario: Status change with a malformed id
- **WHEN** a client sends `PATCH /v1/jobs/abc` with `{ "status": "cancelled" }`
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED` with an issue for the `id` field

### Requirement: Clients can cancel a job that has not finished
A cancel SHALL be accepted for a job in status `pending`, `scheduled` or `processing`: the job
becomes `cancelled`, its completed timestamp is set, and its error, result and attempts stay as
they were. A job waiting for its next attempt after a failure is `scheduled` and is cancelled the
same way; its queued next attempt is then never run.

#### Scenario: Cancel a pending job
- **WHEN** a client cancels a `pending` job
- **THEN** the response has HTTP status 200 and the job in status `cancelled` with a completed timestamp, and getting the job later still shows it `cancelled`

#### Scenario: Cancel a scheduled job
- **WHEN** a client cancels a `scheduled` job
- **THEN** the response has HTTP status 200 and the job in status `cancelled` with a completed timestamp

#### Scenario: Cancel a processing job
- **WHEN** a client cancels a `processing` job with one attempt
- **THEN** the response has HTTP status 200 and the job in status `cancelled` with a completed timestamp and still one attempt

#### Scenario: Cancelled waiting job never runs
- **WHEN** a client cancels a `pending` job on the full system before a worker takes it
- **THEN** getting the job later still shows it `cancelled` with no started timestamp and no result

#### Scenario: Cancel a job waiting for its retry
- **WHEN** a client cancels a job that is `scheduled` for its next attempt after a failed one
- **THEN** the response has HTTP status 200 and the job in status `cancelled` with its error and attempts unchanged, and after its `scheduledAt` has passed the job is still `cancelled` with the same attempts

### Requirement: A cancel stops the job's running work
When a `processing` job is cancelled, the worker running it SHALL stop the job's work, and the job
SHALL stay `cancelled`: no result or error from that run is stored.

#### Scenario: Running job is stopped on the full system
- **WHEN** a client cancels a job on the full system while it is `processing`
- **THEN** getting the job afterwards shows it `cancelled` with no result, also after the time the job would have needed to finish

### Requirement: Clients can retry a failed job
A retry SHALL be accepted only for a job in status `failed`: the job becomes `pending` with zero
attempts, its error, result, started, completed and scheduled timestamps are cleared, and it is put
on the job queue again at once, so it runs as a newly submitted job would, without a retry delay.

#### Scenario: Retry a failed job
- **WHEN** a client retries a `failed` job that has used all its attempts
- **THEN** the response has HTTP status 200 and the job in status `pending` with zero attempts and `null` error, result, started, completed and scheduled timestamps, keeping its id, type, payload, priority, max attempts, idempotency key and created time

#### Scenario: Retried job is queued
- **WHEN** a client retries a `failed` job
- **THEN** the job queue holds a new entry for the job's first attempt, carrying the job's id and available to workers at once

#### Scenario: Retried job runs again on the full system
- **WHEN** a client retries a `failed` job on the full system
- **THEN** a worker takes the job again and getting it later shows it finished again with at least one attempt

#### Scenario: Manual retry survives an unavailable queue
- **WHEN** a client retries a `failed` job while the job queue cannot be reached
- **THEN** the response has HTTP status 200 with the job in status `pending`, and getting the job later still shows it `pending`

### Requirement: A status change from a status that does not allow it is rejected
A cancel of a job in status `completed`, `failed` or `cancelled`, and a retry of a job in any status
other than `failed`, SHALL be answered with HTTP 409 and `JOB_STATUS_CONFLICT` with the current
status in `details`, and the job is unchanged. This includes a job already in the target status.

#### Scenario: Cancel a finished job
- **WHEN** a client cancels a job in status `completed`, `failed` or `cancelled`
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job is unchanged

#### Scenario: Retry a job that has not failed
- **WHEN** a client retries a job in status `scheduled`, `pending`, `processing`, `completed` or `cancelled`
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job is unchanged

### Requirement: Only one status change wins
When a status change and another change of the same job (a worker's state report, another status
change) arrive at the same time, the job SHALL end in the state of exactly one of them; every
change that lost SHALL be answered with HTTP 409 and `JOB_STATUS_CONFLICT`.

#### Scenario: Two cancels at the same time
- **WHEN** two cancels of the same `pending` job are sent at the same time
- **THEN** one answers HTTP 200, the other answers HTTP 409 with the code `JOB_STATUS_CONFLICT`, and the job is `cancelled`

#### Scenario: Two retries at the same time
- **WHEN** two retries of the same `failed` job are sent at the same time
- **THEN** one answers HTTP 200, the other answers HTTP 409 with the code `JOB_STATUS_CONFLICT`, and the job queue holds one new entry for the job
