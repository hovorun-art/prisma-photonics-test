# Spec Delta

## ADDED Requirements

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

### Requirement: A bulk submission is all or nothing
When any item of a bulk submission is invalid, whether by the shared job contract or by a
job-service rule of its type, the whole request SHALL be answered with HTTP 400 and
`VALIDATION_FAILED`, each issue naming the item's position in its field (for example
`jobs.3.payload.to`), and no job of the request SHALL be stored.

#### Scenario: One item with an invalid payload
- **WHEN** a client submits a bulk whose second item has a payload that does not match its type
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue whose field starts with `jobs.1.payload`, and no job is stored

#### Scenario: One item breaking a job-service rule
- **WHEN** a client submits a bulk whose first item is valid and whose second item is a flight transit whose departure day is already over
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue whose field starts with `jobs.1.payload`, and no job is stored

#### Scenario: Unknown job type in one item
- **WHEN** a client submits a bulk whose third item has a type that is not a known job type
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `jobs.2.type` field, and no job is stored

### Requirement: A bulk submission has a size range
A bulk submission with no jobs, or with more jobs than the configured maximum per bulk, SHALL be
answered with HTTP 400 and `VALIDATION_FAILED` with an issue for the `jobs` field, and SHALL store
nothing. A body larger than the configured request body size limit, the same for every route, SHALL
be answered with HTTP 413 and `PAYLOAD_TOO_LARGE`, and SHALL store nothing.

#### Scenario: Empty bulk
- **WHEN** a client submits a bulk with an empty `jobs` array
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `jobs` field, and no job is stored

#### Scenario: Too many jobs
- **WHEN** a client submits a bulk with one job more than the configured maximum per bulk
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `jobs` field naming the maximum, and no job is stored

#### Scenario: Largest allowed bulk
- **WHEN** a client submits a bulk with exactly the configured maximum number of jobs
- **THEN** the response has HTTP status 201 with that many jobs

#### Scenario: Bulk body above the body size limit
- **WHEN** a client submits a bulk whose body is larger than the configured request body size limit
- **THEN** the response has HTTP status 413 and the code `PAYLOAD_TOO_LARGE` naming the limit, and no job is stored

#### Scenario: Bulk body at the body size limit
- **WHEN** a client submits a bulk whose body is exactly the configured request body size limit
- **THEN** the response has HTTP status 201 with the jobs

### Requirement: Bulk-submitted jobs are put on the queue
After the jobs of a bulk are stored, job-service SHALL put an entry for each job's first attempt on
the job queue, under the same rules as a single submission. When putting them on the queue fails,
the bulk submission SHALL still answer HTTP 201 with all jobs, and the jobs SHALL stay `pending`.

#### Scenario: Every bulk job is queued
- **WHEN** a client submits a valid bulk of several jobs
- **THEN** the job queue holds one entry for the first attempt of each created job, carrying that job's id

#### Scenario: Queue unavailable during bulk submit
- **WHEN** a client submits a valid bulk while the job queue cannot be reached
- **THEN** the response has HTTP status 201 with all jobs in status `pending`, and getting them later still shows them `pending`

### Requirement: Jobs can carry a group id
A job submission, single or within a bulk, SHALL accept an optional `groupId`, a UUID, stored with
the job and returned with it by every job route; job-service gives it no other meaning. A job
submitted without it SHALL have `groupId` `null`. A `groupId` that is not a valid UUID SHALL be
answered with HTTP 400 and `VALIDATION_FAILED` naming the field.

#### Scenario: Single job with a group id
- **WHEN** a client submits a job with a `groupId` and then gets it
- **THEN** both responses show the job with that `groupId`

#### Scenario: Bulk items with a group id
- **WHEN** a client submits a bulk whose items all carry the same `groupId`
- **THEN** every created job has that `groupId`

#### Scenario: Job without a group id
- **WHEN** a client submits a job without a `groupId`
- **THEN** the job has `groupId` `null`

#### Scenario: Malformed group id
- **WHEN** a client submits a job whose `groupId` is not a valid UUID
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `groupId` field, and no job is stored

### Requirement: Clients can filter the job query by group
`GET /v1/jobs` SHALL accept one `groupId` query parameter and return only jobs with that
`groupId`; it combines with the `status` and `type` filters (all must match), and `total` counts
the matching jobs. A `groupId` that is not a valid UUID SHALL be answered with HTTP 400 and
`VALIDATION_FAILED` naming the field.

#### Scenario: Only the group's jobs are returned
- **WHEN** jobs of two groups and jobs without a group exist and a client queries with the `groupId` of the first group
- **THEN** the response lists only the first group's jobs, and `total` is their number

#### Scenario: Group filter combines with status and type
- **WHEN** a client queries with a `groupId`, a `status` and a `type`
- **THEN** the response lists only jobs of that group that have one of the given statuses and one of the given types

#### Scenario: Unknown group
- **WHEN** a client queries with a valid UUID that no job carries as `groupId`
- **THEN** the response has HTTP status 200 with no items and `total` 0

#### Scenario: Malformed group id filter
- **WHEN** a client queries with a `groupId` that is not a valid UUID
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `groupId` field
