# Milestone 4: All API endpoints

A user can do everything the task's API list names, from the API and the UI: list jobs filtered by
status and type, cancel jobs that have not finished, retry failed jobs and see queue statistics.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `job-list-filters-service` | job-service filters the job list (`GET /v1/jobs`) by status and type | `job-api` |
| `job-list-filters-ui` | job-ui filter controls on the job list, using the job-service filters, with faceted job counts per status and type on the buttons (served by `GET /v1/stats` with optional `status` and `type`) | `job-list-filters-service`, `job-ui-crud`, `queue-health` |
| `job-update` | A public update route (which fields, in which statuses: decided in the change) and an Edit button on the job page opening `/jobs/:id/edit`, the submit form prefilled with "Save changes" | `job-list-filters-service` |
| `job-status-change` | Cancel a scheduled, pending or processing job (a running job is stopped by its worker) and manually retry a failed job (back to pending with zero attempts, queued again), through `PATCH /v1/jobs/:id` and the job page's Cancel and Retry buttons; replaces the earlier `job-cancel` and `job-retry` | `job-ui-crud`, `webhook-job` |
| `queue-health` | Health check with queue statistics, shown in the UI | `email-job-execution` |

## Open questions

- [x] Whether a running job can be cancelled (beyond the task, which allows only pending/scheduled).
  (Answered in `job-status-change`: yes; job-service tells the workers over Redis pub/sub and the
  one running it stops the handler.)
