# Spec Delta

## Purpose

Brings jobs that got stuck back to a state where they run or end: a waiting job with nothing on
the queue is queued again, a job whose worker died or whose attempt ran too long is treated as a
failed attempt, so no job stays `pending`, `scheduled` or `processing` forever.

## ADDED Requirements

### Requirement: job-service reconciles stuck jobs on a timer
job-service SHALL run a recovery pass at the configured interval that compares the stored state
of jobs with the job queue and recovers the jobs described below. A pass SHALL only consider jobs
that have been in their current state for at least the configured minimum age, so a submission
whose queueing is still in flight is not touched. Every recovery SHALL be logged at warn level
with the job id and the attempt.

#### Scenario: Recovery runs at the configured interval
- **WHEN** job-service runs and the configured interval passes
- **THEN** a recovery pass is run; the next one runs after another interval

#### Scenario: Young jobs are left alone
- **WHEN** a `pending` job has no entry on the job queue and has been `pending` for less than the configured minimum age
- **THEN** a recovery pass does not change it and queues nothing for it

#### Scenario: Recovery is logged
- **WHEN** a recovery pass recovers a job
- **THEN** a warn-level log line carries the job id and the attempt it recovered

### Requirement: A waiting job with no live queue entry is queued again
When a `pending` job, or a `scheduled` job whose `scheduledAt` has passed, has no live entry for
its next attempt on the job queue (live: waiting, delayed or being run), a recovery pass SHALL put
an entry for that attempt on the queue, with the job's priority. The job keeps its status and
attempts. An entry for that attempt that already finished SHALL be replaced by the new one, so the
queue holds one entry for the attempt.

#### Scenario: Pending job whose queueing failed is queued again
- **WHEN** a job was stored `pending` while the queue could not be reached, and the configured minimum age has passed when a recovery pass runs
- **THEN** the job queue holds one entry for the job's first attempt, with the job's priority, and the job is still `pending` with zero attempts

#### Scenario: Due scheduled job with no entry is queued again
- **WHEN** a `scheduled` job whose `scheduledAt` has passed has no entry on the job queue when a recovery pass runs
- **THEN** the job queue holds one entry for the job's next attempt and the job is still `scheduled`

#### Scenario: Scheduled job not yet due is left alone
- **WHEN** a `scheduled` job whose `scheduledAt` is still in the future has no entry on the job queue when a recovery pass runs
- **THEN** nothing is queued for it

#### Scenario: Waiting job with a live entry is left alone
- **WHEN** a `pending` job older than the configured minimum age has an entry waiting on the job queue when a recovery pass runs
- **THEN** the queue still holds exactly that one entry for the job

#### Scenario: Finished entry of a waiting job is replaced
- **WHEN** a `pending` job's entry for its next attempt was taken by a worker that never reported a start and the queue marked it finished, and a recovery pass runs
- **THEN** the job queue holds one entry for that attempt that a worker can take, and the job is still `pending`

#### Scenario: Pending job recovers on the full system
- **WHEN** a job was stored `pending` but never queued (the queue's data was lost after the submission) on the full system
- **THEN** within the configured interval plus the configured minimum age a worker runs it and the job reaches `completed`

### Requirement: A processing job whose entry is no longer being run counts as a lost worker
When a `processing` job's entry for its current attempt exists on the job queue but is no longer
being run by a worker (it went back to waiting after the worker's lease expired, or it was marked
failed or completed), a recovery pass SHALL treat the attempt as failed with the error code
`WORKER_LOST`, under the same rule as any failed attempt: while attempts remain the job is
`scheduled` for its next attempt after the retry delay, otherwise it is `failed`.

#### Scenario: Lost worker with attempts left
- **WHEN** a `processing` job with attempts below its max attempts has its current attempt's entry back in waiting on the job queue when a recovery pass runs
- **THEN** the job is `scheduled` with an error of code `WORKER_LOST`, a `scheduledAt` in the future and its attempts unchanged, and the job queue holds an entry for the next attempt, not available before that `scheduledAt`

#### Scenario: Lost worker on the last attempt
- **WHEN** a `processing` job whose attempts equal its max attempts has its current attempt's entry marked failed on the job queue when a recovery pass runs
- **THEN** the job is `failed` with an error of code `WORKER_LOST` and a completed timestamp, and no new entry is queued

#### Scenario: Lost start report
- **WHEN** a worker's start was applied but its answer was lost, so the worker dropped the entry and the queue marked it completed while the job stays `processing`, and a recovery pass runs after the configured minimum age
- **THEN** the job is `scheduled` for its next attempt with an error of code `WORKER_LOST`

#### Scenario: Processing job whose entry is being run is left alone
- **WHEN** a `processing` job's current attempt's entry is being run by a worker when a recovery pass runs
- **THEN** the job is unchanged

#### Scenario: Processing job whose entry is missing is left to the time limit
- **WHEN** a `processing` job has no entry at all on the job queue and its start is not older than its type's maximum processing time plus the configured interval when a recovery pass runs
- **THEN** the job is unchanged

#### Scenario: Killed worker's job is recovered on the full system
- **WHEN** a job-execution-service instance is killed while it runs a job on the full system with several instances
- **THEN** the job later reaches `completed` with more than one attempt, and its error from the lost attempt is no longer shown once it completed

### Requirement: A processing job past its maximum processing time is timed out
When a `processing` job's start is older than its type's maximum processing time plus the
configured interval, a recovery pass SHALL treat the attempt as failed with the error code
`JOB_TIMEOUT`, under the same rule as any failed attempt, whatever the state of its queue entry.

#### Scenario: Timed-out job with attempts left
- **WHEN** a `processing` job with attempts below its max attempts started longer ago than its type's maximum processing time plus the configured interval when a recovery pass runs
- **THEN** the job is `scheduled` for its next attempt with an error of code `JOB_TIMEOUT`

#### Scenario: Timed-out job on the last attempt
- **WHEN** a `processing` job on its last attempt started longer ago than its type's maximum processing time plus the configured interval when a recovery pass runs
- **THEN** the job is `failed` with an error of code `JOB_TIMEOUT` and a completed timestamp

#### Scenario: Job within its time is left alone
- **WHEN** a `processing` job started less long ago than its type's maximum processing time and its entry is being run when a recovery pass runs
- **THEN** the job is unchanged

### Requirement: Recovery writes are conditional
A recovery SHALL change a job only while the job is still in the state the pass read, so a worker's
report or another job-service instance's pass that changed the job first wins and the recovery
changes nothing.

#### Scenario: Two recovery passes at the same time
- **WHEN** two job-service instances recover the same lost-worker job at the same time
- **THEN** the job's attempts and error are written once, and exactly one entry for the next attempt is on the job queue

#### Scenario: Worker report lands first
- **WHEN** a worker reports `completed` for a job just before a recovery pass that read it as a lost worker writes its change
- **THEN** the job is `completed` with the worker's result and no `WORKER_LOST` error is stored
