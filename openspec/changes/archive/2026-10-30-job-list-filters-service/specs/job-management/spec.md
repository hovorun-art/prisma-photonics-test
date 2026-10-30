# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
