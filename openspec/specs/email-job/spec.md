# email-job Specification

## Purpose

Defines the email job type: its payload and how it is validated on submit, and what running it
does: it simulates sending the email and returns a mock message id, so the whole job path can be
exercised without a real mail server.

## Requirements

### Requirement: Sending an email job is simulated
Running an email job SHALL wait for a random time within the configured range, send nothing, and
return a result with a newly generated message id.

#### Scenario: Email job returns a message id
- **WHEN** an email job is run
- **THEN** the result has a message id that is a UUID, different for every run

#### Scenario: Email job takes a configured time
- **WHEN** an email job is run
- **THEN** it finishes only after a wait within the configured minimum and maximum duration

### Requirement: Clients can submit an email job
`POST /v1/jobs` with type `email` and an email payload (`to`, `subject`, `body`) SHALL be accepted
as described for any job in job-management.

#### Scenario: Valid email job is accepted
- **WHEN** a client submits a job with type `email`, a valid payload, a priority and max attempts within their ranges
- **THEN** the response has HTTP status 201 and the job with a UUID id, status `pending`, zero attempts, the given payload, priority and max attempts, a created timestamp, and `null` result, error, scheduled, started and completed fields

### Requirement: Invalid email payloads are rejected
An email submission whose `to` is not an email address, whose `subject` is empty, or whose `subject`
or `body` is longer than the shared job contract's limit SHALL be answered with HTTP 400 and
`VALIDATION_FAILED`, with an issue for that field, and SHALL store nothing.

#### Scenario: Invalid email address
- **WHEN** a client submits an email job whose `to` is not an email address
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.to` field

#### Scenario: Empty subject
- **WHEN** a client submits an email job with an empty `subject`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.subject` field

#### Scenario: Email field too long
- **WHEN** a client submits an email job whose `subject` or `body` is longer than the contract's limit
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for that field
