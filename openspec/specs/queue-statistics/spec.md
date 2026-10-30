# queue-statistics Specification

## Purpose
Lets clients and the job-ui see how busy the job queue is: how many jobs wait, run and are
scheduled now, how many finished recently, and how fast jobs are completed.

## Requirements

### Requirement: job-service serves queue statistics
job-service SHALL expose a public `GET /v1/stats` route, callable without the internal service
token, that answers HTTP 200 with a body matching the shared statistics contract. The statistics
SHALL cover jobs of every type; the optional `status` and `type` parameters change only the job
counts per status and per type, never the other statistics.

#### Scenario: Statistics of an empty queue
- **WHEN** a client calls `GET /v1/stats` while no job exists
- **THEN** the response has HTTP status 200, matches the statistics contract, and every count and the throughput are zero

#### Scenario: Statistics without a service token
- **WHEN** a client calls `GET /v1/stats` without the internal service token
- **THEN** the response has HTTP status 200

#### Scenario: Jobs of every type are counted
- **WHEN** one pending email job and one pending webhook job exist and a client calls `GET /v1/stats`
- **THEN** the pending count is 2

#### Scenario: Filters leave the other statistics unchanged
- **WHEN** pending email jobs and pending webhook jobs exist and a client calls `GET /v1/stats` with `type` `webhook` and `status` `failed`
- **THEN** the pending, processing, scheduled, recent and throughput values are the same as without the parameters

### Requirement: Current counts of waiting, running and scheduled jobs
The statistics SHALL report how many jobs are in status pending, processing and scheduled at the
moment of the request.

#### Scenario: Current counts by status
- **WHEN** jobs exist in status pending, processing, scheduled, completed, failed and cancelled and a client calls `GET /v1/stats`
- **THEN** the pending, processing and scheduled counts each equal the number of jobs in that status, and completed, failed and cancelled jobs are not part of them

### Requirement: Jobs finished within the recent window
The statistics SHALL report how many jobs completed and how many failed for good within the
configured recent window ending at the moment of the request, together with the window's length.
A failed job that will be retried is not counted as failed.

#### Scenario: Completed and failed within the window
- **WHEN** one job completed and one job failed for good inside the configured recent window and a client calls `GET /v1/stats`
- **THEN** the completed and failed counts are each 1 and the response states the window's length

#### Scenario: Jobs finished before the window
- **WHEN** a job completed and another failed before the configured recent window began and a client calls `GET /v1/stats`
- **THEN** neither is counted in the completed or failed counts

#### Scenario: Failed attempt that will be retried
- **WHEN** a job's attempt failed and the job is pending again for its next attempt and a client calls `GET /v1/stats`
- **THEN** the job is counted as pending, not as failed

### Requirement: Throughput of completed jobs
The statistics SHALL report the throughput as the number of jobs completed within the configured
throughput window ending at the moment of the request, divided by the window's length in minutes,
together with the window's length.

#### Scenario: Throughput over the window
- **WHEN** jobs completed inside the configured throughput window and a client calls `GET /v1/stats`
- **THEN** the throughput equals their number divided by the window's length in minutes, and the response states the window's length

#### Scenario: Only completed jobs count towards throughput
- **WHEN** jobs failed for good inside the configured throughput window and none completed, and a client calls `GET /v1/stats`
- **THEN** the throughput is zero

#### Scenario: Completions before the throughput window
- **WHEN** a job completed before the configured throughput window began and a client calls `GET /v1/stats`
- **THEN** it does not count towards the throughput

### Requirement: Statistics when the database is unavailable
When job-service cannot read job state, `GET /v1/stats` SHALL answer HTTP 500 with the uniform
error body and code `INTERNAL_ERROR`, like the other routes.

#### Scenario: Database unavailable
- **WHEN** reading job state fails and a client calls `GET /v1/stats`
- **THEN** the response has HTTP status 500 and an error body with code `INTERNAL_ERROR`

### Requirement: Statistics route is documented
job-service's OpenAPI documentation SHALL list `GET /v1/stats` with its optional `status` and
`type` parameters and its response schema.

#### Scenario: Docs list the statistics route
- **WHEN** a client opens the documentation route of job-service
- **THEN** the OpenAPI documentation includes `GET /v1/stats` with its `status` and `type` parameters and its response schema

### Requirement: Job counts per status and per type
The statistics SHALL include the number of jobs in each job status and of each job type, over all
jobs in job-service regardless of when they were created or finished. Every known status and every
known type SHALL be present, with zero when no job matches.

#### Scenario: Counts without filters
- **WHEN** two failed webhook jobs, one completed email job and one pending email job exist and a client calls `GET /v1/stats` without parameters
- **THEN** the counts per status are failed 2, completed 1, pending 1 and zero for the other statuses, and the counts per type are webhook 2, email 2 and zero for the other types

#### Scenario: Old finished jobs are counted
- **WHEN** a job completed before the configured recent window began and a client calls `GET /v1/stats`
- **THEN** the count for status completed includes it, while the recent completed count does not

### Requirement: Counts are faceted by the other filter
With a `type` parameter the counts per status SHALL cover only jobs of that type; with a `status`
parameter the counts per type SHALL cover only jobs in that status. A filter SHALL NOT narrow its
own counts, so the counts per status always list every status and the counts per type every type.

#### Scenario: Status counts under a type filter
- **WHEN** failed webhook jobs, failed email jobs and completed webhook jobs exist and a client calls `GET /v1/stats` with `type` `webhook`
- **THEN** the counts per status count only the webhook jobs, and the counts per type count jobs of every type

#### Scenario: Type counts under a status filter
- **WHEN** failed webhook jobs, failed email jobs and completed webhook jobs exist and a client calls `GET /v1/stats` with `status` `failed`
- **THEN** the counts per type count only the failed jobs, and the counts per status count jobs of every status

#### Scenario: Both filters
- **WHEN** failed webhook jobs, failed email jobs and completed webhook jobs exist and a client calls `GET /v1/stats` with `status` `failed` and `type` `webhook`
- **THEN** the counts per status count only the webhook jobs and the counts per type count only the failed jobs

#### Scenario: Count matches the filtered list total
- **WHEN** a client calls `GET /v1/stats` with `type` `webhook` and then `GET /v1/jobs` with `type` `webhook` and `status` `failed`
- **THEN** the failed count of the statistics equals the `total` of the job query

### Requirement: Invalid statistics filters are rejected
A `status` or `type` parameter of `GET /v1/stats` that is empty, not a known job status or job
type, or given more than once SHALL be answered with HTTP 400 and `VALIDATION_FAILED` naming the
field.

#### Scenario: Unknown status filter on statistics
- **WHEN** a client calls `GET /v1/stats` with a `status` value that is not a known job status
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `status` field

#### Scenario: Unknown type filter on statistics
- **WHEN** a client calls `GET /v1/stats` with a `type` value that is not a known job type
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `type` field

#### Scenario: Empty filter value on statistics
- **WHEN** a client calls `GET /v1/stats` with an empty `type` value
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `type` field

#### Scenario: Filter given twice on statistics
- **WHEN** a client calls `GET /v1/stats` with `status` `failed` and `status` `cancelled`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `status` field
