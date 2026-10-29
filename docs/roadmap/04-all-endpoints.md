# Milestone 4: All API endpoints

A user can do everything the task's API list names, from the API and the UI: list jobs filtered by
status and type, cancel pending or scheduled jobs, retry failed jobs and see queue statistics.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `job-list-filters` | Filter the job list by status and type | `job-crud` |
| `job-cancel` | Cancel a pending or scheduled job | `job-crud` |
| `job-retry` | Manually retry a failed job | `job-crud`, `webhook-job` |
| `queue-health` | Health check with queue statistics, shown in the UI | `email-job-flow` |

## Open questions

- [ ] Whether a running job can be cancelled (beyond the task, which allows only pending/scheduled).
