# Proposal

## Why

Milestone 2 needs one job type working end to end. The user chose to build a thin job API first so
that execution (`email-job-execution`) and the UI (`job-ui-crud`) can then be built in parallel
against a fixed contract. Today job-service only answers health checks: there is no job, no job
storage and nothing on the queue.

## What Changes

- Shared job contracts in `packages/contracts`: the job, its statuses, the email job payload and
  result, and the request and response bodies of the public and internal job routes. job-service,
  job-execution-service and job-ui all build on them.
- Job storage in job-service's database (the first table).
- A public API on job-service to submit an email job, get one job, query jobs and delete a finished
  job. Clients cannot edit a job's fields; cancel and retry come in their own changes. Behind
  the API there are only the five base operations (create, get, query, update, delete).
- A submitted job is put on the queue through our own queue interface, so job-execution-service can
  pick it up in the next change.
- An internal API (`/internal`, service token) through which job-execution-service reports a job's
  lifecycle steps (started, completed, failed; job-service decides retry or final failure). This change adds the routes; the next
  change calls them.
- Out of scope here: running jobs (`email-job-execution`), the UI (`job-ui-crud`), query filters,
  cancel, manual retry, retry backoff, priority ordering, scheduling, idempotency, job logs and other job types (their own
  roadmap changes).

## Capabilities

### New Capabilities
- `job-management`: what API clients can do with jobs: submit an email job, read one, query them
  and delete finished ones, and what each answers in normal and error cases.
- `job-state-reporting`: how job-execution-service reports a job's lifecycle steps to job-service and
  which state changes job-service accepts.

### Modified Capabilities
<!-- None: internal-api-access and api-errors keep their requirements; the new routes follow them. -->

## Impact

- `packages/contracts`: new job schemas; `packages/kernel`: new error codes (e.g. job not found,
  state conflict).
- `apps/job-service`: Prisma schema and first migration, job feature in `domain/`, `infra/`, `app/`,
  queue adapter (BullMQ) behind a queue interface, public and internal controllers, Swagger entries
  for the public routes.
- `docker-compose.yml` / config: job-service now needs Redis (queue) besides Postgres.
- `DECISIONS.md`: how the queue maps onto Postgres state on the submit side.
