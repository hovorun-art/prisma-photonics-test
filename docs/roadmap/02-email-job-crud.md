# Milestone 2: One job type end to end

A user can submit an email job from the UI or the API, watch it go from pending to processing to
completed, and read, change and delete jobs. One job type, but the whole path works: API → Postgres
→ queue → job-execution-service → Postgres → UI.

A thin API comes first; execution and UI then build on it in parallel, each on its own branch.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `job-api` | Job contracts, job storage and a public API to create, read, list, update and delete email jobs; new jobs are put on the queue; an internal API lets job-execution-service report job state | `project-scaffold` |
| `email-job-execution` | job-execution-service picks email jobs from the queue, runs them and reports their status and result through the internal API | `job-api` |
| `job-ui-crud` | job-ui lists jobs, shows a job's details, submits email jobs, edits and deletes jobs | `job-api` |

## Open questions

- [ ] Queue integration details (BullMQ to Postgres sync, cancel/retry races): decided in
  `job-api` (enqueue side) and `email-job-execution` (claim and report side).
- [ ] Update scope: which fields can change and in which statuses (proposal: priority and scheduled
  time, only while pending or scheduled): decided in `job-api`.
- [ ] Delete: only finished jobs (completed, failed, cancelled)? Hard or soft delete? Decided in
  `job-api`.
