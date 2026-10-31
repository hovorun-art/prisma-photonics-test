# Spec Delta

## MODIFIED Requirements

### Requirement: Clients can submit a job
`POST /v1/jobs` with a known job type, a payload valid for that type and optionally a priority, max
attempts, an execution time (`scheduledAt`) and an idempotency key SHALL store a new job and answer
HTTP 201 with the job. The new job has a generated UUID id, status `scheduled` when `scheduledAt` is
in the future and `pending` otherwise, and zero attempts; fields not used yet are `null`. A
submission whose idempotency key was already used is answered as the `job-idempotency` spec
describes. Each type's payload is defined in its own spec.

#### Scenario: Defaults are applied
- **WHEN** a client submits a job without priority and max attempts
- **THEN** the job has the default priority and the default max attempts defined by the shared job contract

#### Scenario: Submitted job can be read back
- **WHEN** a client submits a job and then gets it by the returned id
- **THEN** the response is the same job

#### Scenario: Job with a future execution time is scheduled
- **WHEN** a client submits a job with a `scheduledAt` in the future, within the configured maximum time ahead
- **THEN** the response has HTTP status 201 and the job in status `scheduled`, with zero attempts and `scheduledAt` the same instant as requested

#### Scenario: Job with a past execution time runs at once
- **WHEN** a client submits a job with a `scheduledAt` that is not in the future
- **THEN** the response has HTTP status 201 and the job in status `pending`, with `scheduledAt` the same instant as requested

#### Scenario: Job without an execution time
- **WHEN** a client submits a job without `scheduledAt`
- **THEN** the job is in status `pending` and its `scheduledAt` is `null`

#### Scenario: Execution time with a time zone offset
- **WHEN** a client submits a job with a future `scheduledAt` written with a non-UTC offset (for example `+02:00`)
- **THEN** the job is `scheduled` and its `scheduledAt` is the same instant, returned in UTC

#### Scenario: New job has no idempotency key
- **WHEN** a client submits a job without an idempotency key
- **THEN** the job's `idempotencyKey` is `null`

### Requirement: Clients can submit many jobs in one request
`POST /v1/jobs/bulk` with a body `{ jobs: [...] }`, where each item is an ordinary job submission
of any known job type, SHALL store one new job per item and answer HTTP 201 with `{ items }`: the
created jobs in the order of the request. Each item is stored as a single submission would store
it, with the same defaults. An item whose idempotency key was already used is answered as the
`job-idempotency` spec describes, and the bulk answers HTTP 200 when no item created a job.

#### Scenario: Mixed job types are created in request order
- **WHEN** a client submits a bulk of an email job, a webhook job and a flight transit job
- **THEN** the response has HTTP status 201 and three jobs in status `pending`, whose types and payloads match the request items position by position

#### Scenario: Defaults are applied to each item
- **WHEN** a client submits a bulk whose items have no priority and no max attempts
- **THEN** every created job has the default priority and the default max attempts defined by the shared job contract

#### Scenario: Bulk-created jobs can be read back
- **WHEN** a client submits a bulk and then gets each job by its returned id
- **THEN** each response is the same job as in the bulk response

#### Scenario: Jobs of one bulk keep the request order in the job query
- **WHEN** a client submits a bulk of several jobs and then queries all jobs
- **THEN** the jobs of the bulk appear newest first in the reverse order of the request, the first item being the oldest

#### Scenario: Bulk items with and without an execution time
- **WHEN** a client submits a bulk whose first item has a future `scheduledAt` and whose second item has none
- **THEN** the first job is `scheduled` with that `scheduledAt` and the second job is `pending` with a `null` `scheduledAt`

#### Scenario: Bulk item with an execution time too far ahead
- **WHEN** a client submits a bulk whose second item has a `scheduledAt` more than the configured maximum time ahead
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `jobs.1.scheduledAt` field, and no job is stored

#### Scenario: Bulk items carry their keys
- **WHEN** a client submits a bulk whose items carry different idempotency keys
- **THEN** every created job shows its item's `idempotencyKey`
