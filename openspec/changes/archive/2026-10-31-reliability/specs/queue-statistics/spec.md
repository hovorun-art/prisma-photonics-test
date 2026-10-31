# Spec Delta

## MODIFIED Requirements

### Requirement: Jobs finished within the recent window
The statistics SHALL report how many jobs completed and how many failed for good within the
configured recent window ending at the moment of the request, together with the window's length.
A failed job that will be retried is not counted as failed.

#### Scenario: Completed and failed within the window
- **WHEN** one job completed and one job failed for good inside the configured recent window and a client calls `GET /v1/stats`
- **THEN** the completed and failed counts are each 1 and the response states the window's length

#### Scenario: Jobs finished before the window
- **WHEN** a job completed and another failed before the configured recent window began and a client calls `GET /v1/stats`
- **THEN** neither is counted in the completed or failed counts

#### Scenario: Failed attempt that will be retried
- **WHEN** a job's attempt failed and the job is scheduled for its next attempt and a client calls `GET /v1/stats`
- **THEN** the job is counted as scheduled, not as failed
