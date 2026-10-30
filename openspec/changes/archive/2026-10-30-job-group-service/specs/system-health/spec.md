# Spec Delta

## ADDED Requirements

### Requirement: job-group-service answers its health check
job-group-service SHALL expose a public `GET /health` endpoint that answers HTTP 200 with the body
`{ "status": "ok" }` while it is running, whether or not job-service can be reached.

#### Scenario: job-group-service running
- **WHEN** a client calls `GET /health` on a running job-group-service
- **THEN** the response has HTTP status 200 and the body `{ "status": "ok" }`

#### Scenario: job-group-service healthy while job-service is down
- **WHEN** job-service cannot be reached and a client calls `GET /health` on job-group-service
- **THEN** the response has HTTP status 200 and the body `{ "status": "ok" }`

### Requirement: job-group-service publishes its API documentation
job-group-service SHALL publish OpenAPI documentation of its public endpoints.

#### Scenario: job-group-service docs available
- **WHEN** a client opens the documentation route of job-group-service
- **THEN** it receives the OpenAPI documentation, which includes `GET /health`

## MODIFIED Requirements

### Requirement: Graceful shutdown
Every backend service SHALL stop cleanly on a termination signal: it stops accepting new work,
closes its connections and exits with a success code.

#### Scenario: job-execution-service stopped
- **WHEN** a running job-execution-service instance receives a termination signal
- **THEN** it closes its connections and exits with a success code

#### Scenario: job-service stopped
- **WHEN** job-service receives a termination signal
- **THEN** it closes its connections and exits with a success code

#### Scenario: job-group-service stopped
- **WHEN** job-group-service receives a termination signal
- **THEN** it stops polling, closes its connections and exits with a success code
