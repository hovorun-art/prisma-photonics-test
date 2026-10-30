# job-management Specification

## Purpose
Lets API clients submit background jobs, read and query them and delete finished ones, with
predictable answers for every normal and error case. Each job type's payload and result are defined
in its own spec (`email-job`, `webhook-job`, `flight-transit-job`).

## Requirements

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
`offset` jobs, newest first by creation time, and the total number of jobs that match the query's
filters (all jobs when no filter is given). Without `limit` the configured default page size
applies; without `offset`, zero.

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
A `limit` that is not a positive integer or exceeds the configured maximum page size, an
`offset` that is not a non-negative integer, or a `status` or `type` value that is empty or not a
known job status or job type SHALL be answered with HTTP 400 and `VALIDATION_FAILED` naming the
field.

#### Scenario: Limit above maximum
- **WHEN** a client queries jobs with a `limit` above the configured maximum page size
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `limit` field

#### Scenario: Negative offset
- **WHEN** a client queries jobs with a negative `offset`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `offset` field

#### Scenario: Unknown status filter
- **WHEN** a client queries jobs with a `status` value that is not a known job status
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `status` field

#### Scenario: Unknown type filter
- **WHEN** a client queries jobs with a `type` value that is not a known job type
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `type` field

#### Scenario: Empty filter value
- **WHEN** a client queries jobs with an empty `status` value
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `status` field

#### Scenario: One unknown value among known ones
- **WHEN** a client queries jobs with two `status` values, one known and one unknown
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `status` field

### Requirement: Clients can filter the job query by status
`GET /v1/jobs` SHALL accept one or more `status` query parameters, each repeated as its own
parameter, and return only jobs whose status is one of the given values. Giving the same value
twice has the same effect as giving it once. Without a `status` parameter jobs of every status are
returned.

#### Scenario: Filter by one status
- **WHEN** a client queries jobs with `status` `failed` while jobs in several statuses exist
- **THEN** only the failed jobs are returned, newest first, and `total` is the number of failed jobs

#### Scenario: Filter by several statuses
- **WHEN** a client queries jobs with `status` `failed` and `status` `cancelled` while jobs in several statuses exist
- **THEN** only the failed and cancelled jobs are returned, newest first, and `total` is their number

#### Scenario: Repeated status value
- **WHEN** a client queries jobs with `status` `failed` given twice
- **THEN** the response is the same as for `status` `failed` given once

#### Scenario: No job matches the status
- **WHEN** a client queries jobs with a known status that no job has
- **THEN** the response has HTTP status 200 with no items and `total` zero

### Requirement: Clients can filter the job query by type
`GET /v1/jobs` SHALL accept one or more `type` query parameters, each repeated as its own
parameter, and return only jobs whose type is one of the given values. Giving the same value twice
has the same effect as giving it once. Without a `type` parameter jobs of every type are returned.

#### Scenario: Filter by one type
- **WHEN** a client queries jobs with `type` `webhook` while jobs of several types exist
- **THEN** only the webhook jobs are returned, newest first, and `total` is the number of webhook jobs

#### Scenario: Filter by several types
- **WHEN** a client queries jobs with `type` `email` and `type` `webhook` while jobs of several types exist
- **THEN** only the email and webhook jobs are returned, newest first, and `total` is their number

### Requirement: Status and type filters combine
When both `status` and `type` are given, `GET /v1/jobs` SHALL return only jobs that match one of
the given statuses and one of the given types, and `limit` and `offset` SHALL page through these
matching jobs only.

#### Scenario: Status and type together
- **WHEN** a client queries jobs with `status` `failed` and `type` `webhook` while failed email jobs and completed webhook jobs also exist
- **THEN** only the failed webhook jobs are returned and `total` is their number

#### Scenario: Paging through filtered jobs
- **WHEN** a client queries jobs with `status` `failed`, `limit` 2 and `offset` 1 while four failed jobs and other jobs exist
- **THEN** the items are the second and third newest failed jobs and `total` is four

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
the bulk submission SHALL still answer HTTP 201 with all jobs, and the jobs SHALL stay in the status
they were created with.

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
