# Spec Delta

## MODIFIED Requirements

### Requirement: Job routes are documented
The public job routes SHALL appear in job-service's OpenAPI documentation with their request and
response schemas.

#### Scenario: Docs list the job routes
- **WHEN** a client opens the documentation route of job-service
- **THEN** it lists submit, get, query, status change and delete under `/v1/jobs` with their request and response schemas
