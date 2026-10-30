# email-job Specification

## Purpose

Defines what running an email job does: it simulates sending the email and returns a mock message
id, so the whole job path can be exercised without a real mail server.

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
