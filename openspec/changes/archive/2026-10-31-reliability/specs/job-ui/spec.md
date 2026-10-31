# Spec Delta

## ADDED Requirements

### Requirement: The job page shows the idempotency key
The Details list of the job page SHALL show an "Idempotency key" row with the job's key when the
job has one, and no such row when the job has none. The submit form does not change in this
respect: it offers no working key field and generates no key.

#### Scenario: Job with a key
- **WHEN** a user opens the page of a job that was submitted with an idempotency key
- **THEN** the Details list shows "Idempotency key" with that key

#### Scenario: Job without a key
- **WHEN** a user opens the page of a job that has no idempotency key
- **THEN** the Details list shows no "Idempotency key" row

#### Scenario: Submit form unchanged
- **WHEN** a user opens the submit page
- **THEN** the idempotency key field is still shown disabled with its "Coming soon" tooltip, and no key is sent with a submission
