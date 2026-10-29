# Spec Delta

## Purpose

Lets operators, reviewers and job-ui see whether the job queue system is running: whether the
API's dependencies (database, queue) are reachable and which execution instances are alive.

## ADDED Requirements

### Requirement: Health endpoint reports dependency status
job-service SHALL expose a public `GET /health` endpoint that reports an overall status and the
status of each dependency (database and queue store). The overall status SHALL be healthy only when
every dependency is reachable.

#### Scenario: All dependencies reachable
- **WHEN** a client calls `GET /health` while the database and the queue store are reachable
- **THEN** the response has HTTP status 200, overall status `ok`, and both dependencies reported as `up`

#### Scenario: Database unreachable
- **WHEN** a client calls `GET /health` while the database is unreachable
- **THEN** the response has HTTP status 503, overall status `unavailable`, the database reported as `down` and the queue store as `up`

#### Scenario: Queue store unreachable
- **WHEN** a client calls `GET /health` while the queue store is unreachable
- **THEN** the response has HTTP status 503, overall status `unavailable`, the queue store reported as `down` and the database as `up`

### Requirement: Health endpoint lists live execution instances
The health response SHALL list the job-execution-service instances that are currently alive. An
instance counts as alive while its heartbeat is fresher than the configured heartbeat expiry.

#### Scenario: Running instances are listed
- **WHEN** two job-execution-service instances are ready and sending heartbeats and a client calls `GET /health`
- **THEN** the response lists both instances by their instance id

#### Scenario: Stopped instance disappears
- **WHEN** an instance stops sending heartbeats and the configured heartbeat expiry passes
- **THEN** `GET /health` no longer lists that instance

#### Scenario: No instances running
- **WHEN** no job-execution-service instance is running and a client calls `GET /health`
- **THEN** the response lists no instances, and the overall status still depends only on the dependencies

### Requirement: Execution instance announces itself only when ready
A job-execution-service instance SHALL start sending heartbeats only after it has reached the queue
store and job-service. Until then it SHALL keep retrying with the configured backoff and log each
failed attempt.

#### Scenario: Dependency unavailable at startup
- **WHEN** an instance starts while job-service is unreachable
- **THEN** the instance logs the failed attempts, sends no heartbeat and is not listed by `GET /health`

#### Scenario: Dependency becomes available
- **WHEN** job-service becomes reachable while the instance is retrying
- **THEN** the instance starts sending heartbeats and appears in `GET /health`

### Requirement: Graceful shutdown
Every backend service SHALL stop cleanly on a termination signal: it stops accepting new work,
closes its connections and exits with a success code. A stopping execution instance SHALL stop
sending heartbeats.

#### Scenario: Execution instance stopped
- **WHEN** a running job-execution-service instance receives a termination signal
- **THEN** it exits with a success code and is no longer listed by `GET /health` once its heartbeat is removed or expires

#### Scenario: job-service stopped
- **WHEN** job-service receives a termination signal
- **THEN** it closes its connections and exits with a success code

### Requirement: job-ui shows backend reachability
job-ui SHALL show a text that states whether the backend is reachable, based on the health
endpoint, and refresh it at the configured polling interval.

#### Scenario: Backend reachable
- **WHEN** job-ui is opened and `GET /health` answers
- **THEN** the page shows text stating the backend is reachable

#### Scenario: Backend unreachable
- **WHEN** job-ui is opened and `GET /health` cannot be reached
- **THEN** the page shows text stating the backend is not reachable

#### Scenario: Status recovers
- **WHEN** the backend becomes reachable again while the page is open
- **THEN** the text changes to reachable within the configured polling interval, without a page reload

### Requirement: API documentation is published
job-service SHALL publish OpenAPI documentation of its public endpoints.

#### Scenario: Docs available
- **WHEN** a client opens the documentation route of job-service
- **THEN** it receives the OpenAPI documentation, which includes `GET /health`
