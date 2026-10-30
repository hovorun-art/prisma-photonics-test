# job-management Specification

## Purpose
Lets API clients submit background jobs, read and query them and delete finished ones, with
predictable answers for every normal and error case. Each job type's payload and result are defined
in its own spec (`email-job`, `webhook-job`).

## Requirements

### Requirement: Clients can submit a job
`POST /v1/jobs` with a known job type, a payload valid for that type and optionally a priority and
max attempts SHALL store a new job and answer HTTP 201 with the job. The new job has a generated
UUID id, status `pending` and zero attempts; fields not used yet are `null`. Each type's payload is
defined in its own spec.

#### Scenario: Defaults are applied
- **WHEN** a client submits a job without priority and max attempts
- **THEN** the job has the default priority and the default max attempts defined by the shared job contract

#### Scenario: Submitted job can be read back
- **WHEN** a client submits a job and then gets it by the returned id
- **THEN** the response is the same job

### Requirement: Invalid job submissions are rejected
A submission whose type is not a known job type, whose payload does not match its type, or whose
priority or max attempts fall outside the limits of the shared job contract SHALL be answered with
HTTP 400 and `VALIDATION_FAILED`, listing each issue with its field, and SHALL store nothing. The
payload rules of each type are in that type's spec.

#### Scenario: Unknown job type
- **WHEN** a client submits a job with a type that is not a known job type
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `type` field, and no job is stored

#### Scenario: Priority out of range
- **WHEN** a client submits a job whose priority is not an integer within the contract's priority range
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `priority` field

#### Scenario: Max attempts out of range
- **WHEN** a client submits a job whose max attempts is not an integer within the contract's range
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `maxAttempts` field

### Requirement: Submitted jobs are put on the queue
After a job is stored, job-service SHALL put an entry for the job's first attempt on the job queue.
The entry carries only the job id, and the same attempt of a job SHALL never be on the queue twice.

#### Scenario: Submitted job is queued
- **WHEN** a client submits a valid job
- **THEN** the job queue holds one entry for the job's first attempt, carrying the job's id

#### Scenario: Same attempt is not queued twice
- **WHEN** the entry for a job's attempt is put on the queue a second time
- **THEN** the job queue still holds only one entry for that attempt

### Requirement: Submission survives an unavailable queue
When the job is stored but putting it on the queue fails, the submission SHALL still answer HTTP
201 with the job, and the job SHALL stay `pending`.

#### Scenario: Queue unavailable during submit
- **WHEN** a client submits a valid job while the job queue cannot be reached
- **THEN** the response has HTTP status 201 with the job in status `pending`, and getting the job later still shows it `pending`

### Requirement: Clients can get a job
`GET /v1/jobs/:id` SHALL answer HTTP 200 with the job. A well-formed id that matches no job SHALL
be answered with HTTP 404 and `JOB_NOT_FOUND`; an id that is not a valid UUID SHALL be answered with
HTTP 400 and `VALIDATION_FAILED`.

#### Scenario: Existing job
- **WHEN** a client gets a job by the id of an existing job
- **THEN** the response has HTTP status 200 and the job with all its fields

#### Scenario: Unknown job
- **WHEN** a client gets a job by a valid UUID that matches no job
- **THEN** the response has HTTP status 404 and the code `JOB_NOT_FOUND`

#### Scenario: Malformed id
- **WHEN** a client gets a job by an id that is not a valid UUID
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED` with an issue for the `id` field

### Requirement: Clients can query jobs a page at a time
`GET /v1/jobs` SHALL answer HTTP 200 with `{ items, total }`: at most `limit` jobs after skipping
`offset` jobs, newest first by creation time, and the total number of jobs. Without `limit` the
configured default page size applies; without `offset`, zero.

#### Scenario: Newest first
- **WHEN** a client queries jobs after three jobs were submitted one after another
- **THEN** the items are in reverse order of submission and `total` is three

#### Scenario: Paging
- **WHEN** a client queries jobs with `limit` 2 and `offset` 1 while five jobs exist
- **THEN** the items are the second and third newest jobs and `total` is five

#### Scenario: Default page size
- **WHEN** a client queries jobs without `limit` while more jobs exist than the configured default page size
- **THEN** the number of items equals the configured default page size

#### Scenario: Empty query result
- **WHEN** a client queries jobs while no job exists
- **THEN** the response has HTTP status 200 with no items and `total` zero

### Requirement: Invalid query parameters are rejected
A `limit` that is not a positive integer or exceeds the configured maximum page size, or an
`offset` that is not a non-negative integer, SHALL be answered with HTTP 400 and
`VALIDATION_FAILED` naming the field.

#### Scenario: Limit above maximum
- **WHEN** a client queries jobs with a `limit` above the configured maximum page size
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `limit` field

#### Scenario: Negative offset
- **WHEN** a client queries jobs with a negative `offset`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `offset` field

### Requirement: Clients can delete finished jobs
`DELETE /v1/jobs/:id` SHALL remove a job whose status is `completed`, `failed` or `cancelled` and
answer HTTP 204 with no body; the job is gone for good. Any other status SHALL be answered with HTTP
409 and `JOB_STATUS_CONFLICT`, with the current status in `details`, and the job stays.

#### Scenario: Delete a finished job
- **WHEN** a client deletes a job in status `completed`, `failed` or `cancelled`
- **THEN** the response has HTTP status 204 with no body, and getting the job afterwards answers HTTP 404 `JOB_NOT_FOUND`

#### Scenario: Delete a job that has not finished
- **WHEN** a client deletes a job in status `pending` or `processing`
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the current status in `details`, and the job is unchanged

#### Scenario: Delete an unknown job
- **WHEN** a client deletes a job by a valid UUID that matches no job
- **THEN** the response has HTTP status 404 and the code `JOB_NOT_FOUND`

### Requirement: Job routes are documented
The public job routes SHALL appear in job-service's OpenAPI documentation with their request and
response schemas.

#### Scenario: Docs list the job routes
- **WHEN** a client opens the documentation route of job-service
- **THEN** it lists submit, get, query and delete under `/v1/jobs` with their request and response schemas
