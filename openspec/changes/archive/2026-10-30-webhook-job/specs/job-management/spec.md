# Spec Delta

## REMOVED Requirements

### Requirement: Clients can submit an email job
**Reason**: Split by job type: the generic rule is now "Clients can submit a job"; the email payload and its scenario moved to the email-job spec.
**Migration**: See "Clients can submit a job" here and "Clients can submit an email job" in email-job; behaviour is unchanged.

### Requirement: Invalid submissions are rejected
**Reason**: Split by job type: the generic rule is now "Invalid job submissions are rejected"; the email scenarios moved to the email-job spec.
**Migration**: See "Invalid job submissions are rejected" here and "Invalid email payloads are rejected" in email-job; behaviour is unchanged.

## ADDED Requirements

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
