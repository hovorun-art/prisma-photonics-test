# system-health Specification

## Purpose

Lets operators, reviewers and container healthchecks see that each part of the job queue system is
running: both backend services answer a health check and the UI shows that it has started.

## Requirements

### Requirement: job-service answers its health check
job-service SHALL expose a public `GET /health` endpoint that answers HTTP 200 with the body
`{ "status": "ok" }` while it is running.

#### Scenario: job-service running
- **WHEN** a client calls `GET /health` on a running job-service
- **THEN** the response has HTTP status 200 and the body `{ "status": "ok" }`

### Requirement: job-execution-service answers its health check
job-execution-service SHALL expose `GET /health` that answers HTTP 200 with the body
`{ "status": "ok" }` while it is running.

#### Scenario: job-execution-service running
- **WHEN** a client calls `GET /health` on a running job-execution-service instance
- **THEN** the response has HTTP status 200 and the body `{ "status": "ok" }`

### Requirement: Execution instance announces that it has started
A job-execution-service instance SHALL log that it has started once it has connected to the queue
store.

#### Scenario: Instance started
- **WHEN** a job-execution-service instance starts while the queue store is reachable
- **THEN** it logs that it has started

### Requirement: Graceful shutdown
Every backend service SHALL stop cleanly on a termination signal: it stops accepting new work,
closes its connections and exits with a success code.

#### Scenario: job-execution-service stopped
- **WHEN** a running job-execution-service instance receives a termination signal
- **THEN** it closes its connections and exits with a success code

#### Scenario: job-service stopped
- **WHEN** job-service receives a termination signal
- **THEN** it closes its connections and exits with a success code

### Requirement: job-ui shows that it has started
job-ui SHALL show basic information that the UI has started (the application name and a short
started message). It SHALL NOT call the backend or show any backend status.

#### Scenario: UI started
- **WHEN** a user opens job-ui
- **THEN** the page shows the application name and the started message

#### Scenario: Backend not needed
- **WHEN** a user opens job-ui while job-service is not running
- **THEN** the page still shows the application name and the started message, and no request to the backend is made

### Requirement: API documentation is published
job-service SHALL publish OpenAPI documentation of its public endpoints.

#### Scenario: Docs available
- **WHEN** a client opens the documentation route of job-service
- **THEN** it receives the OpenAPI documentation, which includes `GET /health`
