# Spec Delta

## Purpose

Keeps job-service's internal methods, used only by job-execution-service to read and change job
state, out of reach of external clients.

## ADDED Requirements

### Requirement: Internal routes require the service token
Every job-service route under the `/internal` prefix SHALL require the configured service token.
Requests without it or with a wrong token SHALL be rejected with HTTP status 401 and the error code
for unauthorized internal access, without running the route.

#### Scenario: Missing token
- **WHEN** a client calls an `/internal` route without a service token
- **THEN** the response has HTTP status 401 and the unauthorized-internal-access error code

#### Scenario: Wrong token
- **WHEN** a client calls an `/internal` route with a token that differs from the configured one
- **THEN** the response has HTTP status 401 and the unauthorized-internal-access error code

#### Scenario: Valid token
- **WHEN** job-execution-service calls an `/internal` route with the configured service token
- **THEN** the route runs and answers normally

### Requirement: Internal routes are not in the public documentation
The OpenAPI documentation published by job-service SHALL NOT list any `/internal` route.

#### Scenario: Docs exclude internal routes
- **WHEN** a client opens the documentation route of job-service
- **THEN** no route under `/internal` appears in it

### Requirement: Execution service reaches job-service only through the internal API
job-execution-service SHALL check that job-service is reachable through an `/internal` route using
the configured service token, and SHALL have no direct access to the database.

#### Scenario: Reachability check with token
- **WHEN** a job-execution-service instance starts and job-service is running
- **THEN** its reachability check calls job-service's internal API with the service token and succeeds

#### Scenario: Misconfigured token
- **WHEN** a job-execution-service instance starts with a service token that job-service rejects
- **THEN** the instance logs the rejection, keeps retrying, and sends no heartbeat
