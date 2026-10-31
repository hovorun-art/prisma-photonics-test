# job-idempotency Specification

## Purpose
Lets a client submit a job more than once without creating it twice: a submission may carry an
idempotency key, and a repeated submission with a key that was already used answers with the
existing job instead of a new one.

## Requirements

### Requirement: A submission may carry an idempotency key
A job submission, single or as an item of a bulk, SHALL accept an optional `idempotencyKey`, a
string within the length limits of the shared job contract. It is stored with the job and
returned with it by every job route; a job submitted without one has `idempotencyKey` `null`. A
key outside the limits SHALL be answered with HTTP 400 and `VALIDATION_FAILED` with an issue for
the `idempotencyKey` field, and nothing is stored.

#### Scenario: Job with a key
- **WHEN** a client submits a job with an `idempotencyKey` and then gets it
- **THEN** both responses show the job with that `idempotencyKey`

#### Scenario: Job without a key
- **WHEN** a client submits a job without an `idempotencyKey`
- **THEN** the job has `idempotencyKey` `null`

#### Scenario: Empty key
- **WHEN** a client submits a job whose `idempotencyKey` is an empty string
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `idempotencyKey` field, and no job is stored

#### Scenario: Key too long
- **WHEN** a client submits a job whose `idempotencyKey` is longer than the contract's maximum length
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `idempotencyKey` field, and no job is stored

#### Scenario: Bulk item with a bad key
- **WHEN** a client submits a bulk whose second item has an empty `idempotencyKey`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `jobs.1.idempotencyKey` field, and no job is stored

### Requirement: A repeated submission answers with the existing job
When a submission carries an `idempotencyKey` of an existing job and asks for the same job (the
same type, payload, priority, max attempts, scheduled time and group as that job was submitted
with, with the contract's defaults applied), job-service SHALL answer HTTP 200 with the existing
job and create nothing. The key is matched before job-service's own time-dependent rules, so a
replay of a request that was valid when first sent is answered the same way.

#### Scenario: Identical replay
- **WHEN** a client submits a job with an `idempotencyKey` and then submits the identical request again
- **THEN** the first response has HTTP status 201, the second has HTTP status 200 with the same job id, and the total number of jobs grew by one

#### Scenario: Replay spelling out the defaults
- **WHEN** a client submits a job with a key and no priority or max attempts, then submits it again with the contract's default priority and max attempts written out
- **THEN** the second response has HTTP status 200 with the same job

#### Scenario: Replay after a failed attempt
- **WHEN** a client submits a job with a key, the job's first attempt fails and the job waits for its retry, and the client submits the identical request again
- **THEN** the response has HTTP status 200 with the same job, in its current state

#### Scenario: Replay of a flight transit after its departure day
- **WHEN** a client submitted a flight transit job with a key and submits the identical request again after the departure day is over
- **THEN** the response has HTTP status 200 with the existing job

#### Scenario: Replay of a scheduled job in another time zone notation
- **WHEN** a client submits a scheduled job with a key and submits it again with the same `scheduledAt` instant written with another offset
- **THEN** the response has HTTP status 200 with the same job

### Requirement: A used key with a different request is a conflict
When a submission carries an `idempotencyKey` of an existing job but asks for a different job (any
of type, payload, priority, max attempts, scheduled time or group differs from what that job was
submitted with), job-service SHALL answer HTTP 409 with the code `IDEMPOTENCY_KEY_CONFLICT` and
the existing job's id in `details`, and create nothing.

#### Scenario: Same key, different payload
- **WHEN** a client submits a job with a key and then a job with the same key and another payload
- **THEN** the second response has HTTP status 409, the code `IDEMPOTENCY_KEY_CONFLICT` and the first job's id in `details`, and no second job is stored

#### Scenario: Same key, different priority
- **WHEN** a client submits a job with a key and then the same job with the same key and another priority
- **THEN** the second response has HTTP status 409 and the code `IDEMPOTENCY_KEY_CONFLICT`

#### Scenario: Same key, different group
- **WHEN** a client submits a job with a key and then the same job with the same key and another `groupId`
- **THEN** the second response has HTTP status 409 and the code `IDEMPOTENCY_KEY_CONFLICT`

### Requirement: Concurrent submissions with a new key create one job
When several submissions with the same new `idempotencyKey` and the same request arrive at the
same time, exactly one job SHALL be created; the submission that created it answers HTTP 201 and
every other one answers HTTP 200, all with that job.

#### Scenario: Two submissions at the same time
- **WHEN** two identical submissions with the same new key are sent at the same time
- **THEN** one answers HTTP 201 and the other HTTP 200, both with the same job id, and one job with that key exists

### Requirement: A key is remembered as long as its job exists
An `idempotencyKey` SHALL stay taken while its job exists and become free when the job is deleted;
nothing expires on a timer.

#### Scenario: Key reused after the job was deleted
- **WHEN** a client deletes a finished job that had a key and then submits a job with that key
- **THEN** the response has HTTP status 201 with a new job carrying the key

#### Scenario: Key taken by a finished job
- **WHEN** a client submits the identical request of a `completed` job with its key
- **THEN** the response has HTTP status 200 with the completed job

### Requirement: Bulk items with used keys answer with the existing jobs
In a bulk submission, an item whose `idempotencyKey` matches an existing job with the same request
SHALL be answered with that job at its position and the other items SHALL be created. The bulk
answers HTTP 201 when it created at least one job and HTTP 200 when every item matched an existing
job.

#### Scenario: One item already exists
- **WHEN** a client submits a bulk of three items where the second item's key and request match an existing job
- **THEN** the response has HTTP status 201 with the existing job at position two and two new jobs at positions one and three

#### Scenario: Every item already exists
- **WHEN** a client submits a bulk whose every item matches an existing job by key and request
- **THEN** the response has HTTP status 200 with the existing jobs in request order, and no job is created

### Requirement: A bulk with a conflicting or repeated key stores nothing
An item whose key matches an existing job with a different request SHALL make the whole bulk
answer HTTP 409 `IDEMPOTENCY_KEY_CONFLICT` with that job's id in `details`, and nothing is stored.
Two items of one bulk with the same key SHALL be answered with HTTP 400 and `VALIDATION_FAILED`
with an issue for the second item's `idempotencyKey`, and nothing is stored.

#### Scenario: One item conflicts
- **WHEN** a client submits a bulk where one item's key matches an existing job with a different payload
- **THEN** the response has HTTP status 409, the code `IDEMPOTENCY_KEY_CONFLICT` and the existing job's id in `details`, and no job of the bulk is stored

#### Scenario: Duplicate key within the bulk
- **WHEN** a client submits a bulk whose first and third items carry the same `idempotencyKey`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `jobs.2.idempotencyKey` field, and no job is stored

#### Scenario: Bulk retried after a lost answer on the full system
- **WHEN** a client submits a bulk with a key per item on the full system and sends the same bulk again
- **THEN** the second response has HTTP status 200 with the same job ids, and the jobs exist once
