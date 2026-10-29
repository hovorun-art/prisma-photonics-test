# api-errors Specification

## Purpose

Gives API clients one predictable error format: every error response carries a stable code from a
closed set, a message and structured details, so clients handle errors by code, never by text.

## Requirements

### Requirement: Every error response has the same body
Every error response from job-service SHALL have the body `{ code, message, details }`, where `code`
is one of the closed set of error codes, `message` is human-readable text and `details` is an object
(empty when there is nothing to add).

#### Scenario: Known failure
- **WHEN** a request fails with an expected failure, such as a call to an `/internal` route without the service token
- **THEN** the response body has the failure's code, a message and a details object

#### Scenario: Unexpected failure
- **WHEN** a request fails because of an unexpected error inside job-service
- **THEN** the response has HTTP status 500 and the body has the code `INTERNAL_ERROR`, a message and a details object without internal information

### Requirement: Unknown routes use the error body
A request to a route job-service does not have SHALL be answered with HTTP status 404 and the code
`ROUTE_NOT_FOUND` in the error body.

#### Scenario: Unknown route
- **WHEN** a client calls a route that does not exist
- **THEN** the response has HTTP status 404 and the body has the code `ROUTE_NOT_FOUND`, a message and a details object

### Requirement: Invalid requests use the error body
A request whose input fails validation SHALL be answered with HTTP status 400 and the code
`VALIDATION_FAILED`, with the validation issues listed in `details`.

#### Scenario: Invalid request
- **WHEN** a client sends a request whose input fails validation
- **THEN** the response has HTTP status 400, the body has the code `VALIDATION_FAILED`, and `details` lists each validation issue with the field it concerns

#### Scenario: Malformed body
- **WHEN** a client sends a request body that is not valid JSON
- **THEN** the response has HTTP status 400 and the body has the code `VALIDATION_FAILED`, a message and a details object

### Requirement: Oversized requests use the error body
A request whose body is larger than the configured size limit SHALL be answered with HTTP status
413 and the code `PAYLOAD_TOO_LARGE`, with the limit in `details`.

#### Scenario: Body too large
- **WHEN** a client sends a request body larger than the configured size limit
- **THEN** the response has HTTP status 413, the body has the code `PAYLOAD_TOO_LARGE`, and `details` contains the limit
