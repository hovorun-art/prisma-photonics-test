# Spec Delta

## Purpose

Decides the order in which waiting jobs are started: higher priority first, submission order within
one priority, and jobs submitted with a future execution time not before that time.

## ADDED Requirements

### Requirement: Higher-priority jobs start first
When several jobs are waiting to be started, job-execution-service SHALL start a job with a higher
priority before any waiting job with a lower priority.

#### Scenario: High priority overtakes earlier low priority
- **WHEN** a job with a low priority is queued, then a job with a higher priority is queued, and only then a worker starts taking jobs
- **THEN** the job with the higher priority is started first

#### Scenario: Priorities are taken highest first
- **WHEN** jobs with the lowest, the default and the highest priority of the contract's range are queued in that order before a worker starts taking jobs
- **THEN** they are started in the order highest, default, lowest

### Requirement: Equal priority keeps submission order
Waiting jobs with the same priority SHALL be started in the order in which they were queued.

#### Scenario: Same priority, first in first out
- **WHEN** three jobs with the same priority are queued one after another before a worker starts taking jobs
- **THEN** they are started in the order they were queued

### Requirement: A retry keeps the job's priority
The entry queued for a job's next attempt after a failed attempt SHALL have the job's priority.

#### Scenario: Retried high-priority job overtakes waiting low-priority jobs
- **WHEN** a high-priority job's attempt fails with attempts left while lower-priority jobs are waiting
- **THEN** the high-priority job's next attempt is started before the waiting lower-priority jobs

### Requirement: A scheduled job does not start before its time
A job in status `scheduled` SHALL not be started before its `scheduledAt`.

#### Scenario: Scheduled job waits
- **WHEN** a job is submitted with a `scheduledAt` in the future and a worker is free
- **THEN** the job stays `scheduled` with no attempts until its `scheduledAt`

### Requirement: A scheduled job starts when its time arrives
When a scheduled job's `scheduledAt` arrives, it SHALL become available to workers with its
priority, and run and finish like a job submitted without a time.

#### Scenario: Scheduled job runs after its time
- **WHEN** a job is submitted with a `scheduledAt` a few seconds in the future
- **THEN** after that time the job is started and reaches `completed`, and its started timestamp is not before its `scheduledAt`

#### Scenario: Due scheduled job competes by priority
- **WHEN** a high-priority scheduled job becomes due while lower-priority jobs are waiting
- **THEN** the scheduled job is started before the waiting lower-priority jobs
