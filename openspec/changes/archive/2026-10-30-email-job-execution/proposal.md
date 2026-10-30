# Proposal

## Why

Since `job-api`, a submitted email job is stored as pending and put on the queue, but nothing runs
it: it stays pending forever. This change makes job-execution-service take queued jobs, run email
jobs and report each step to job-service, so a job goes pending → processing → completed and the
milestone's whole path (API → Postgres → queue → execution → Postgres) works.

## What Changes

- job-execution-service consumes the job queue: it takes an entry, reads the job through
  job-service's internal API and reports its start, completion or failure through the internal
  update (`PATCH /internal/v1/jobs/:id`), as specified in `job-state-reporting`.
- An email job handler that simulates sending: it waits a while and returns a mock message id.
- job-execution-service gets the settings it needs to reach job-service (URL, service token) and
  to run jobs (how many at once per instance).
- Handlers live behind a handler interface per job type, so later job types (webhook, flight
  transit, batch) plug in the same way.
- Out of scope: retry backoff, crash recovery of jobs stuck in processing, priority ordering,
  scheduled jobs, job logs and other job types (their own roadmap changes).

## Capabilities

### New Capabilities
- `job-execution`: how queued jobs are picked up and run by job-execution-service, what happens
  when a job is no longer runnable, and how outcomes are reported.
- `email-job`: what running an email job does and returns.

### Modified Capabilities
<!-- None expected: job-state-reporting already states what job-service accepts. -->

## Impact

- `apps/job-execution-service`: queue consumer (BullMQ behind our queue interface), internal API
  client, execution feature, `notifications` domain module with the email handler, config.
- `packages/contracts`: possibly shared pieces the client needs (already there: `Job`,
  `UpdateJobRequest`, `JobQueueMessage`, `INTERNAL_JOBS_ROUTE`).
- `docker-compose.yml`, `.env.example`: job-service URL and service token for job-execution-service.
- `DECISIONS.md`: job pickup and what a worker crash means at this stage.
