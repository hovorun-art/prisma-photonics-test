# Concept

Source: `docs/Interview Task - Senior AI-Integrated Full Stack Engineer (1).pdf` (interview task
"Job Queue Service"). A source for decisions, not a spec: each point becomes a decision only inside a
change (decisions.md "Decided").

## What it is

A distributed background job processing system: clients submit async jobs (emails, webhooks,
reports, batch processing), workers execute them, and a UI shows their state. The assessment focuses
on concurrency, failure scenarios and state management; trade-offs and thought process matter more
than a single "right" answer. Use of AI coding assistants is explicitly encouraged.

## Components

1. **API service**: accepts job submissions and status queries.
2. **Queue**: holds pending jobs (any queue/cache technology).
3. **Worker process(es)**: pull jobs and execute them.
4. **Database**: stores job state and results.

Flow: Client → API → Queue → Worker(s); API and workers both read/write job state in the DB.

## API

- Submit a new job
- Get job status, result or error
- List jobs with filters (status, type)
- Cancel a pending/scheduled job
- Retry a failed job
- Health check with queue statistics

## Job lifecycle

Statuses: `scheduled`, `pending`, `processing`, `completed`, `failed`, `cancelled`.

- New job → `pending`, or → `scheduled` when it has a future execution time.
- `scheduled` → `pending` (or straight to `processing`) when the scheduled time arrives.
- `pending` → `processing` when a worker picks it up.
- `pending` / `scheduled` → `cancelled` on cancel.
- `processing` → `completed` or `failed`.
- `failed` → `pending` on manual retry.

## Job types (mock)

1. **Email**: simulates sending an email; sleeps 1–3 s, returns success with a mock message ID.
2. **Webhook**: simulates calling an external webhook; sleeps 1–2 s; 80% success, 20% simulated
   failure (to exercise retry logic).
3. **Aircraft transit report**: generates a report of an aircraft transit between any two airports,
   with dates and geo locations of origin and destination. The UI shows a map with the aircraft's
   path. Data may come from any free public API or be made up.
   Bonus: hover on the map shows aircraft and transit details.
4. **Batch**: processes multiple items with a small delay each, tracks progress percentage, returns
   a summary.

## Data model

**Job**: unique id; type and JSON payload; status; priority (higher = more urgent); attempts
(current, max); error information for failed jobs; progress percentage (batch); optional scheduled
execution time; timestamps (created, started, completed); JSON result; idempotency key (duplicate
prevention).

**Job log** (optional, recommended): job reference; level (info, warning, error); message and
metadata; timestamp.

## Critical implementation details

1. Job pickup: preventing duplicate processing
2. Worker crash recovery
3. Retry with backoff
4. Priority queue
5. Scheduled jobs
6. Idempotency

## UI

A clean UI (stated in the tips) to work with jobs, including the map for aircraft transit reports.

## Deliverables

A Git repository with:

- `README.md`: how to run the project, how to run tests, an example request to submit a test job,
  a brief architecture overview.
- `DECISIONS.md` (required), sections: 1. Job pickup strategy (approach, why, trade-offs);
  2. Worker crash recovery (approach, why, what happens if a worker crashes mid-job);
  3. Priority queue implementation (approach, why); 4. Retry backoff strategy (approach, specific
  timings); 5. One thing I would do differently with more time.
- `AI_USAGE.md`: tools used; what helped most (1–2 cases); what I had to fix (1–2 cases, especially
  around concurrency); what AI struggled with.
- Text/MD file(s) with the chat with the AI tool.
- `docker-compose.yml`, `Dockerfile`, application code, tests.

## Suggested order (from the task's tips)

1. Basic flow first: submit → queue → process → complete.
2. Failure handling: retries, error storage.
3. Clean UI.
4. Concurrency.
5. The map and the API part.
6. Honest DECISIONS.md.
7. Test the worker independently.
8. Small, clean commits.
