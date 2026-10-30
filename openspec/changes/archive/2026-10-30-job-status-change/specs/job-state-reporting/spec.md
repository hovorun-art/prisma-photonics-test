# Spec Delta

## ADDED Requirements

### Requirement: Reports for a cancelled job are refused
Any state report (`processing`, `completed` or `failed`) for a job in status `cancelled` SHALL be
answered with HTTP 409 and `JOB_STATUS_CONFLICT` with the current status in `details`; the job
stays `cancelled` and nothing from the report is stored.

#### Scenario: Completion reported after a cancel
- **WHEN** job-execution-service reports `completed` with a valid result for a job that was cancelled while it ran
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the status `cancelled` in `details`, and the job stays `cancelled` with no result

#### Scenario: Failure reported after a cancel
- **WHEN** job-execution-service reports `failed` with an error for a job that was cancelled while it ran
- **THEN** the response has HTTP status 409, the code `JOB_STATUS_CONFLICT` and the status `cancelled` in `details`, the job stays `cancelled`, and no new entry for the job is put on the job queue

#### Scenario: Start reported for a cancelled job
- **WHEN** job-execution-service reports `processing` for a job that was cancelled while it waited
- **THEN** the response has HTTP status 409 and the code `JOB_STATUS_CONFLICT`, and the job stays `cancelled` with its attempts unchanged
