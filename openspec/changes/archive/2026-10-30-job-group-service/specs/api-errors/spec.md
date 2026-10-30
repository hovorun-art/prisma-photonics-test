# Spec Delta

## MODIFIED Requirements

### Requirement: Every error response has the same body
Every error response from job-service and from job-group-service SHALL have the body
`{ code, message, details }`, where `code` is one of the closed set of error codes, `message` is
human-readable text and `details` is an object (empty when there is nothing to add).

#### Scenario: Known failure
- **WHEN** a request fails with an expected failure, such as a call to an `/internal` route without the service token
- **THEN** the response body has the failure's code, a message and a details object

#### Scenario: Unexpected failure
- **WHEN** a request fails because of an unexpected error inside job-service
- **THEN** the response has HTTP status 500 and the body has the code `INTERNAL_ERROR`, a message and a details object without internal information

#### Scenario: Unexpected failure in job-group-service
- **WHEN** a request to job-group-service fails because of an unexpected error inside it
- **THEN** the response has HTTP status 500 and the body has the code `INTERNAL_ERROR`, a message and a details object without internal information

### Requirement: Unknown routes use the error body
A request to a route job-service or job-group-service does not have SHALL be answered with HTTP
status 404 and the code `ROUTE_NOT_FOUND` in the error body.

#### Scenario: Unknown route
- **WHEN** a client calls a route that does not exist
- **THEN** the response has HTTP status 404 and the body has the code `ROUTE_NOT_FOUND`, a message and a details object

#### Scenario: Unknown route on job-group-service
- **WHEN** a client calls a route that job-group-service does not have
- **THEN** the response has HTTP status 404 and the body has the code `ROUTE_NOT_FOUND`, a message and a details object
