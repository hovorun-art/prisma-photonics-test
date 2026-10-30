# Spec Delta

## MODIFIED Requirements

### Requirement: Clients can submit a job
`POST /v1/jobs` with a known job type, a payload valid for that type and optionally a priority, max
attempts and an execution time (`scheduledAt`) SHALL store a new job and answer HTTP 201 with the
job. The new job has a generated UUID id, status `scheduled` when `scheduledAt` is in the future and
`pending` otherwise, and zero attempts; fields not used yet are `null`. Each type's payload is
defined in its own spec.

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

### Requirement: Invalid job submissions are rejected
A submission whose type is not a known job type, whose payload does not match its type, whose
priority or max attempts fall outside the limits of the shared job contract, or whose `scheduledAt`
is not an ISO 8601 timestamp with a time zone or lies more than the configured maximum time ahead
SHALL be answered with HTTP 400 and `VALIDATION_FAILED`, listing each issue with its field, and
SHALL store nothing. The payload rules of each type are in that type's spec.

#### Scenario: Unknown job type
- **WHEN** a client submits a job with a type that is not a known job type
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `type` field, and no job is stored

#### Scenario: Priority out of range
- **WHEN** a client submits a job whose priority is not an integer within the contract's priority range
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `priority` field

#### Scenario: Max attempts out of range
- **WHEN** a client submits a job whose max attempts is not an integer within the contract's range
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `maxAttempts` field

#### Scenario: Execution time is not a timestamp
- **WHEN** a client submits a job whose `scheduledAt` is not an ISO 8601 timestamp with a time zone (for example a date only, or a time without offset)
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `scheduledAt` field, and no job is stored

#### Scenario: Execution time too far ahead
- **WHEN** a client submits a job whose `scheduledAt` lies more than the configured maximum time ahead
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `scheduledAt` field naming the maximum, and no job is stored

#### Scenario: Execution time at the maximum
- **WHEN** a client submits a job whose `scheduledAt` lies exactly the configured maximum time ahead
- **THEN** the response has HTTP status 201 and the job in status `scheduled`

### Requirement: Submitted jobs are put on the queue
After a job is stored, job-service SHALL put an entry for the job's first attempt on the job queue,
with the job's priority, and for a `scheduled` job not available to workers before its
`scheduledAt`. The entry carries only the job id, and the same attempt of a job SHALL never be on the
queue twice.

#### Scenario: Submitted job is queued
- **WHEN** a client submits a valid job
- **THEN** the job queue holds one entry for the job's first attempt, carrying the job's id

#### Scenario: Same attempt is not queued twice
- **WHEN** the entry for a job's attempt is put on the queue a second time
- **THEN** the job queue still holds only one entry for that attempt

#### Scenario: Scheduled job is queued for its time
- **WHEN** a client submits a job with a future `scheduledAt`
- **THEN** the job queue holds one entry for the job's first attempt with the job's priority, which becomes available to workers at the job's `scheduledAt`

### Requirement: Submission survives an unavailable queue
When the job is stored but putting it on the queue fails, the submission SHALL still answer HTTP
201 with the job, and the job SHALL stay in the status it was created with (`pending` or
`scheduled`).

#### Scenario: Queue unavailable during submit
- **WHEN** a client submits a valid job while the job queue cannot be reached
- **THEN** the response has HTTP status 201 with the job in status `pending`, and getting the job later still shows it `pending`

#### Scenario: Queue unavailable during a scheduled submit
- **WHEN** a client submits a job with a future `scheduledAt` while the job queue cannot be reached
- **THEN** the response has HTTP status 201 with the job in status `scheduled`, and getting the job later still shows it `scheduled`

### Requirement: Clients can submit many jobs in one request
`POST /v1/jobs/bulk` with a body `{ jobs: [...] }`, where each item is an ordinary job submission
of any known job type, SHALL store one new job per item and answer HTTP 201 with `{ items }`: the
created jobs in the order of the request. Each item is stored as a single submission would store
it, with the same defaults.

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

### Requirement: Bulk-submitted jobs are put on the queue
After the jobs of a bulk are stored, job-service SHALL put an entry for each job's first attempt on
the job queue, under the same rules as a single submission. When putting them on the queue fails,
the bulk submission SHALL still answer HTTP 201 with all jobs, and the jobs SHALL stay in the status
they were created with.

#### Scenario: Every bulk job is queued
- **WHEN** a client submits a valid bulk of several jobs
- **THEN** the job queue holds one entry for the first attempt of each created job, carrying that job's id

#### Scenario: Queue unavailable during bulk submit
- **WHEN** a client submits a valid bulk while the job queue cannot be reached
- **THEN** the response has HTTP status 201 with all jobs in status `pending`, and getting them later still shows them `pending`
