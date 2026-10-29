# Milestone 2: One job type end to end

A user can submit an email job from the UI or the API, watch it go from pending to processing to
completed, and read, change and delete jobs. One job type, but the whole path works: API → Postgres
→ queue → job-execution-service → Postgres → UI.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `email-job-flow` | Submit an email job, execute it in job-execution-service and see its status and result (API and UI) | `project-scaffold` |
| `job-crud` | Read and list jobs, update jobs that have not started, delete finished jobs (API and UI) | `email-job-flow` |

## Open questions

- [ ] Queue integration details (BullMQ to Postgres sync, cancel/retry races): decided in
  `email-job-flow`.
- [ ] Update scope: which fields can change and in which statuses (proposal: priority and scheduled
  time, only while pending or scheduled).
- [ ] Delete: only finished jobs (completed, failed, cancelled)? Hard or soft delete?
