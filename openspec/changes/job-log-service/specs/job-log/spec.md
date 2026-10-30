# Spec Delta

## Purpose

Records what happened to each job, step by step and attempt by attempt, and lets API clients and
the UI read a job's log, without logging ever slowing down or failing a job.

## ADDED Requirements

### Requirement: job-service logs the lifecycle steps it decides
job-service SHALL add a log entry when a job is submitted, when an attempt is queued, when queueing
an attempt fails, when an attempt starts, when a job completes, when an attempt fails and the next
attempt is scheduled, and when a job fails for good. Entries of an attempt carry its number.

#### Scenario: Submitted and queued job is logged
- **WHEN** a client submits a job and it is put on the queue
- **THEN** the job's log has an `info` entry for the submission without an attempt and an `info` entry for queueing attempt 1

#### Scenario: Queueing failure is logged
- **WHEN** a job is stored but putting it on the queue fails
- **THEN** the job's log has a `warning` entry for the failed queueing of attempt 1

#### Scenario: Started and completed job is logged
- **WHEN** an attempt of a job is reported `processing` and then `completed`
- **THEN** the job's log has an `info` entry for the start of that attempt and an `info` entry for the completion, both carrying the attempt number

#### Scenario: Failed attempt with a retry is logged
- **WHEN** an attempt is reported `failed` while the job has attempts left
- **THEN** the job's log has a `warning` entry for that attempt with the error's code and message in its metadata, and an entry for queueing the next attempt

#### Scenario: Job failed for good is logged
- **WHEN** the last allowed attempt is reported `failed`
- **THEN** the job's log has an `error` entry for that attempt with the error's code and message in its metadata

### Requirement: job-execution-service logs the steps of an attempt
job-execution-service SHALL add a log entry when a worker picks up an attempt, when the handler
starts, when the handler finishes (with its duration), when a state report to job-service is
retried, and when an entry is dropped because the job is not `pending`. These entries name the
worker instance that wrote them.

#### Scenario: Run of an attempt is logged
- **WHEN** a worker picks up an attempt and its handler runs and finishes
- **THEN** the job's log has entries for the pickup, the handler start and the handler finish with its duration in the metadata, each naming the worker instance and carrying the attempt number

#### Scenario: Retried state report is logged
- **WHEN** a worker's state report cannot reach job-service and is tried again
- **THEN** the job's log has a `warning` entry for the retried report naming the worker instance

#### Scenario: Dropped entry is logged
- **WHEN** a worker takes a queue entry whose job is no longer `pending`
- **THEN** the job's log has an `info` entry saying the entry was dropped, naming the worker instance

### Requirement: Job log entries come from the services' job-related log lines
Every log line a service writes at info level or above that names a job SHALL also become an entry
in that job's log, with the same message and level (`warn` shown as `warning`). The line's other
fields SHALL become the entry's metadata after secrets are redacted; an error keeps only its type
and code. Lines below info level SHALL NOT become entries.

#### Scenario: Log line becomes an entry
- **WHEN** a service writes a warning log line naming a job
- **THEN** the job's log has a `warning` entry with the same message

#### Scenario: Debug line is not an entry
- **WHEN** a service writes a debug log line naming a job
- **THEN** the job's log has no entry for it

#### Scenario: Secrets and stacks stay out of the entry
- **WHEN** a log line naming a job carries a field that the log redaction covers and an error with a message, a code and a stack trace
- **THEN** the entry's metadata shows the field redacted and the error with only its type and code

### Requirement: A log entry describes one step
Each entry SHALL have an id, the job id, the attempt number (absent for steps outside an attempt), a
level (`info`, `warning` or `error`), a message, a metadata object, a timestamp with milliseconds,
and its source: `job-service`, or `job-execution-service` with the worker instance id.

#### Scenario: Entry fields
- **WHEN** a client reads the log of a job that a worker has run
- **THEN** every entry has an id, the job id, a level, a message, a metadata object, a timestamp with milliseconds and a source, and the worker's entries carry the worker instance id and the attempt number

### Requirement: Clients read a job's log oldest first
`GET /v1/jobs/:id/logs` SHALL answer HTTP 200 with `{ items, nextCursor }`: at most `limit` entries
(the configured default when omitted), oldest first. `nextCursor` marks the last entry returned;
given as `after`, it returns only later entries. With no entries returned, `nextCursor` is the
`after` given, or null when none was given.

#### Scenario: Read a job's log
- **WHEN** a client calls `GET /v1/jobs/:id/logs` for a job with log entries
- **THEN** the answer is HTTP 200 with the entries oldest first, at most the configured default number of them, and a `nextCursor`

#### Scenario: Read only newer entries
- **WHEN** a client calls the route again with the previous `nextCursor` as `after` after new entries were written
- **THEN** the answer holds only the entries written after the previous last entry

#### Scenario: Nothing new
- **WHEN** a client calls the route with an `after` cursor and no later entries exist
- **THEN** the answer is HTTP 200 with no items and `nextCursor` equal to the given cursor

#### Scenario: Job with no entries yet
- **WHEN** a client reads the log of a job none of whose entries has been written yet
- **THEN** the answer is HTTP 200 with no items and a null `nextCursor`

#### Scenario: Paging with limit
- **WHEN** a job has more entries than the given `limit` and a client follows `nextCursor`
- **THEN** each answer holds at most `limit` entries and following the cursors returns every entry once, oldest first

### Requirement: The log can be filtered by level
`GET /v1/jobs/:id/logs` SHALL accept one or more `level` query parameters, each repeated as its own
parameter, and return only entries whose level is one of them; `limit` and `after` page through the
matching entries only.

#### Scenario: Only error entries
- **WHEN** a client reads the log of a job with entries of every level and passes `level=error`
- **THEN** the answer holds only the `error` entries

#### Scenario: Two levels
- **WHEN** a client passes `level=warning&level=error`
- **THEN** the answer holds only `warning` and `error` entries

### Requirement: Invalid log queries are rejected
A job id that is not a UUID, a `limit` that is not a positive integer or exceeds the configured
maximum, a `level` that is not a known level, and an `after` that is not a cursor the route issued
SHALL be answered with HTTP 400 and `VALIDATION_FAILED`, with an issue naming the field.

#### Scenario: Id is not a UUID
- **WHEN** a client calls `GET /v1/jobs/not-a-uuid/logs`
- **THEN** the answer is HTTP 400 with `VALIDATION_FAILED` and an issue for the id

#### Scenario: Limit above the maximum
- **WHEN** a client passes a `limit` above the configured maximum
- **THEN** the answer is HTTP 400 with `VALIDATION_FAILED` and an issue for `limit`

#### Scenario: Unknown level
- **WHEN** a client passes `level=debug`
- **THEN** the answer is HTTP 400 with `VALIDATION_FAILED` and an issue for `level`

#### Scenario: Malformed cursor
- **WHEN** a client passes an `after` value the route did not issue
- **THEN** the answer is HTTP 400 with `VALIDATION_FAILED` and an issue for `after`

### Requirement: The log of a missing job is not found
A well-formed id that matches no job SHALL be answered with HTTP 404 and `JOB_NOT_FOUND`. This also
applies to a deleted job, whose log entries can no longer be read and are removed by retention.

#### Scenario: Unknown job
- **WHEN** a client reads the log of a UUID that matches no job
- **THEN** the answer is HTTP 404 with `JOB_NOT_FOUND`

#### Scenario: Deleted job
- **WHEN** a client deletes a finished job that has log entries and then reads its log
- **THEN** the answer is HTTP 404 with `JOB_NOT_FOUND`

### Requirement: An unavailable log store is reported
When the log store cannot be reached, `GET /v1/jobs/:id/logs` SHALL answer HTTP 503 with
`LOG_STORE_UNAVAILABLE`. The other job routes SHALL keep working.

#### Scenario: Log store down on read
- **WHEN** a client reads a job's log while the log store is down
- **THEN** the answer is HTTP 503 with `LOG_STORE_UNAVAILABLE`, and `GET /v1/jobs/:id` for the same job still answers HTTP 200

### Requirement: Logging never blocks or fails a job
A job SHALL run and change state the same way whether or not its log entries can be sent or
stored. Entries that could not be stored because the log store was down SHALL appear once it is
back. Entries that could not be sent because Redis was down are lost.

#### Scenario: Log store down while a job runs
- **WHEN** a job runs to completion while the log store is down, and the log store comes back
- **THEN** the job is `completed`, and after the log store is back its log holds the entries of that run

#### Scenario: Entry cannot be sent
- **WHEN** sending a job's log entry fails
- **THEN** the step that wrote it goes on as if the entry had been sent

### Requirement: Each entry appears once
Each log entry SHALL appear in the job's log exactly once, also when the writer stops after storing
a batch of entries and before confirming it, and the batch is stored again.

#### Scenario: Writer crash after storing a batch
- **WHEN** the writer stores a batch of entries, stops before confirming it, and the batch is stored again after a restart
- **THEN** the job's log holds each of those entries once

### Requirement: Log entries are kept for the configured retention period
Log entries older than the configured retention period SHALL be removed and no longer returned.

#### Scenario: Expired entries
- **WHEN** a job's log entries are older than the configured retention period
- **THEN** they are removed from the log store and no longer returned by the log route

### Requirement: The log route is documented
`GET /v1/jobs/:id/logs` SHALL appear in job-service's OpenAPI documentation with its query parameters
and response schema.

#### Scenario: Log route in the API docs
- **WHEN** a client opens job-service's OpenAPI document
- **THEN** it lists `GET /v1/jobs/{id}/logs` with the `limit`, `after` and `level` parameters and the log response schema
