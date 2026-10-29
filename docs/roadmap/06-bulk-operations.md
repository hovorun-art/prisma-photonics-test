# Milestone 6: Bulk operations

A user can act on many jobs in one request: submit, update, cancel, retry and delete in bulk, with a
result for each item. Beyond the task's requirements.

## Changes

| Change | Intent | Depends on |
|---|---|---|
| `bulk-job-operations` | Bulk versions of submit, update, cancel, retry and delete, with per-item results (API and UI) | `job-cancel`, `job-retry`, `idempotency` |

## Open questions

- [ ] Limits on items per request; whether bulk submit is all-or-nothing or per item (proposal: per item).
