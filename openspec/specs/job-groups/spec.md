# job-groups Specification

## Purpose

Lets a client follow many jobs as one group (for example an email campaign): job-group-service
holds the group, counts how its child jobs in job-service ended and tells whether the group is
still running, completed or failed.

## Requirements

### Requirement: Clients can create a group
`POST /v1/groups` on job-group-service, without a body, SHALL create an empty group and answer HTTP
201 with it: a new id, status `running`, stats `total`, `completed` and `failed` all 0,
`createdAt`, `updatedAt`, `checkedAt` `null` and `finishedAt` `null`. The group's id is the
`groupId` a client gives the jobs it submits to job-service; job-group-service submits no jobs.

#### Scenario: New group
- **WHEN** a client creates a group
- **THEN** the response has HTTP status 201 and a group with a new UUID id, status `running`, `total`, `completed` and `failed` 0, and `checkedAt` and `finishedAt` `null`

#### Scenario: Each group has its own id
- **WHEN** a client creates two groups
- **THEN** the two groups have different ids

### Requirement: Clients can get a group
`GET /v1/groups/:id` SHALL answer HTTP 200 with the group as job-group-service last stored it; it
does not ask job-service on the request. An id no group has SHALL be answered with HTTP 404 and
`JOB_GROUP_NOT_FOUND`; an id that is not a valid UUID SHALL be answered with HTTP 400 and
`VALIDATION_FAILED`. The group does not list its child jobs.

#### Scenario: Existing group
- **WHEN** a client creates a group and then gets it by its id
- **THEN** the response has HTTP status 200 and the same group

#### Scenario: Group read while job-service is down
- **WHEN** job-service cannot be reached and a client gets an existing group
- **THEN** the response has HTTP status 200 with the group's last stored stats and status

#### Scenario: Unknown group
- **WHEN** a client gets a group with a valid UUID that no group has
- **THEN** the response has HTTP status 404 and the code `JOB_GROUP_NOT_FOUND`

#### Scenario: Malformed group id
- **WHEN** a client gets a group with an id that is not a valid UUID
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `id` field

### Requirement: Clients can list groups a page at a time
`GET /v1/groups` SHALL answer HTTP 200 with `{ items, total }`: one page of groups, newest first,
and the number of all groups. It accepts `limit` and `offset`; without `limit` the configured
default page size applies. A `limit` above the configured maximum, a `limit` below 1 or a negative
`offset` SHALL be answered with HTTP 400 and `VALIDATION_FAILED`.

#### Scenario: Newest first
- **WHEN** a client creates three groups one after another and lists groups
- **THEN** the response has HTTP status 200, the three groups newest first, and `total` 3

#### Scenario: Paging
- **WHEN** three groups exist and a client lists groups with `limit` 2 and `offset` 2
- **THEN** the response lists only the oldest group and `total` is 3

#### Scenario: Default page size
- **WHEN** more groups than the configured default page size exist and a client lists groups without `limit`
- **THEN** the response lists the configured default number of groups and `total` counts all groups

#### Scenario: Limit above the maximum
- **WHEN** a client lists groups with a `limit` one above the configured maximum
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `limit` field

#### Scenario: Invalid paging values
- **WHEN** a client lists groups with `limit` 0 or a negative `offset`
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED` with an issue for that field

#### Scenario: No groups
- **WHEN** no group exists and a client lists groups
- **THEN** the response has HTTP status 200 with no items and `total` 0

### Requirement: Clients can delete an empty group
`DELETE /v1/groups/:id` SHALL delete the group and answer HTTP 204 when job-service, asked at that
moment, reports no job with that `groupId`. When job-service reports at least one, it SHALL answer
HTTP 409 with `JOB_GROUP_NOT_EMPTY` and keep the group; when job-service cannot be reached, HTTP 503
with `JOB_SERVICE_UNAVAILABLE` and keep the group. Unknown and malformed ids are answered as for get.

#### Scenario: Group whose submit failed
- **WHEN** a client creates a group, its job submit to job-service fails so no job carries the group id, and the client deletes the group
- **THEN** the response has HTTP status 204 and getting the group afterwards answers HTTP 404 with `JOB_GROUP_NOT_FOUND`

#### Scenario: Group with children
- **WHEN** job-service has a job with the group's id and a client deletes the group
- **THEN** the response has HTTP status 409 and the code `JOB_GROUP_NOT_EMPTY`, and the group can still be read

#### Scenario: job-service unreachable on delete
- **WHEN** job-service cannot be reached and a client deletes a group
- **THEN** the response has HTTP status 503 and the code `JOB_SERVICE_UNAVAILABLE`, and the group can still be read

#### Scenario: Delete unknown group
- **WHEN** a client deletes a group with a valid UUID that no group has
- **THEN** the response has HTTP status 404 and the code `JOB_GROUP_NOT_FOUND`

#### Scenario: Delete with malformed id
- **WHEN** a client deletes a group with an id that is not a valid UUID
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `id` field

### Requirement: Group stats follow the child jobs
At the configured poll interval job-group-service SHALL read from job-service's job query the jobs
carrying each running group's id and store: `total`, the highest child count job-service has ever
reported for the group; `completed`, the children in status `completed`; `failed`, the children in
status `failed` or `cancelled` plus the children missing from the highest count; and `checkedAt`.

#### Scenario: Children submitted after creation
- **WHEN** a client creates a group, submits three jobs with its id to job-service, and one poll interval passes
- **THEN** getting the group shows `total` 3 and a `checkedAt` time

#### Scenario: Counts by outcome
- **WHEN** a running group has one completed, one failed, one cancelled and one pending child and one poll interval passes
- **THEN** getting the group shows `total` 4, `completed` 1 and `failed` 2

#### Scenario: Deleted child counts as failed
- **WHEN** a running group had three children reported by job-service, one finished child is deleted through job-service, and one poll interval passes
- **THEN** getting the group shows `total` 3 and the deleted child counted in `failed`

#### Scenario: Children submitted in several requests
- **WHEN** a client submits two jobs with a group's id, a poll interval passes, then submits two more and another poll interval passes
- **THEN** getting the group shows `total` 4

### Requirement: Group status follows the child jobs
A group SHALL be `running` while it has no children or while `completed` plus `failed` is less than
`total`. When at least one child exists and `completed` plus `failed` equals `total`, the group
SHALL become `completed` if every child completed and `failed` otherwise, with `finishedAt` set.
A failed child SHALL NOT cancel or otherwise change the other children.

#### Scenario: Group without children keeps running
- **WHEN** a group has no child jobs and several poll intervals pass
- **THEN** the group stays `running` with `total` 0

#### Scenario: Some children still running
- **WHEN** a group has one completed and one processing child and a poll interval passes
- **THEN** the group is `running` with `finishedAt` `null`

#### Scenario: All children completed
- **WHEN** every child of a group has completed and a poll interval passes
- **THEN** the group is `completed`, `completed` equals `total`, and `finishedAt` is set

#### Scenario: A child failed
- **WHEN** every child of a group has finished, one of them `failed` and the rest `completed`, and a poll interval passes
- **THEN** the group is `failed` with `finishedAt` set

#### Scenario: A child was cancelled
- **WHEN** every child of a group has finished, one of them `cancelled` and the rest `completed`, and a poll interval passes
- **THEN** the group is `failed` with `finishedAt` set

#### Scenario: A failed child does not stop the others
- **WHEN** one child of a group fails while its other children are pending
- **THEN** the group stays `running` and the other children still run to their own end in job-service

### Requirement: A finished group no longer changes
Once a group is `completed` or `failed`, job-group-service SHALL no longer poll it, and its stats,
status and `finishedAt` SHALL stay as they were, even when jobs with its id are added, retried or
deleted in job-service later.

#### Scenario: Job added after the group finished
- **WHEN** a group is `completed` and a client submits another job with its id to job-service, and a poll interval passes
- **THEN** getting the group shows the same status, stats and `finishedAt` as before

### Requirement: A failed poll keeps the last state
When job-service cannot be reached or answers with an error during a poll, job-group-service SHALL
keep each affected group's last stats, status and `checkedAt`, log the failure, and try again at
the next poll interval.

#### Scenario: job-service down during a poll
- **WHEN** a running group has stats from an earlier poll and job-service cannot be reached at the next poll
- **THEN** getting the group shows the earlier stats, status and `checkedAt`

#### Scenario: job-service back
- **WHEN** job-service could not be reached at one poll and is reachable again at the next
- **THEN** getting the group after the next poll shows the current stats and a newer `checkedAt`

### Requirement: Group routes are documented
job-group-service SHALL publish OpenAPI documentation of its group routes, with their request
parameters, responses and error responses.

#### Scenario: Group routes in the docs
- **WHEN** a client opens job-group-service's documentation route
- **THEN** the documentation lists `POST /v1/groups`, `GET /v1/groups`, `GET /v1/groups/{id}` and `DELETE /v1/groups/{id}`
