# Spec Delta

## MODIFIED Requirements

### Requirement: Queued pending jobs are run and reported
For each queue entry, job-execution-service SHALL read the job from job-service, report it
`processing`, run the handler of the job's type and report `completed` with the handler's result.
A `scheduled` job whose entry is delivered is run the same way as a `pending` one.

#### Scenario: Pending job runs to completion
- **WHEN** an entry is queued for a pending email job
- **THEN** job-execution-service reports the job `processing`, runs the email handler and reports it `completed` with the handler's result

#### Scenario: Submitted email job completes end to end
- **WHEN** a client submits an email job to job-service on the full system
- **THEN** getting the job later shows status `completed` with a result that has a message id

#### Scenario: Scheduled job runs to completion
- **WHEN** the entry of a `scheduled` email job is delivered to job-execution-service
- **THEN** job-execution-service reports the job `processing`, runs the email handler and reports it `completed` with the handler's result

### Requirement: Jobs that are no longer runnable are skipped
When the job read for an entry is neither `pending` nor `scheduled`, or no longer exists,
job-execution-service SHALL drop the entry without running a handler and without reporting anything.

#### Scenario: Job already taken or finished
- **WHEN** an entry is queued for a job whose status is `processing`, `completed`, `failed` or `cancelled`
- **THEN** no handler runs and no state report is sent for it

#### Scenario: Job deleted
- **WHEN** an entry is queued for a job that job-service no longer has
- **THEN** no handler runs and no state report is sent for it
