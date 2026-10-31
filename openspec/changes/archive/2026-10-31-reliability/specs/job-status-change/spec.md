# Spec Delta

## MODIFIED Requirements

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
