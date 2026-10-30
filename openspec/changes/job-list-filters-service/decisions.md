# Decisions: job-list-filters-service

## Decided

- Backend only: job-service filters `GET /v1/jobs` by status and type; the job-ui controls are a
  separate later change, `job-list-filters-ui` (user)
- `job-update` depends on `job-list-filters-service`, not on the UI change (user)
- Several statuses or types are given as repeated query parameters (`?status=failed&status=cancelled&type=webhook`); no comma-separated form (user)
- With filters, `total` counts the matching jobs, so paging works over the filtered list (user)
- An unknown status or type value is answered with HTTP 400 `VALIDATION_FAILED` and an issue for that field (user)
- Only status and type filters; date ranges, sort order and other filters are out of scope (user)
- The query parameters are named `status` and `type`, after the job's own fields (user confirmed assumption)
- Status and type filters combine with AND (a job must match both); within one filter several values combine with OR (user confirmed assumption)
- Without a filter parameter, that filter is not applied (today's behaviour stays) (user confirmed assumption)
- An empty value (`status=`) is rejected as `VALIDATION_FAILED` for that field, not read as "no filter" (user confirmed assumption)
- The same value given twice counts once (user confirmed assumption)
- Ordering and paging stay as today (newest first, `limit`/`offset` applied to the filtered jobs) (user confirmed assumption)
- No index changes in this change: the existing `(status, created_at)` and `(type, created_at)` indexes stay; their gaps (multi-value and combined filters, ties without `id`, large offsets) are measured in `demo-seed` and revisited with sort order and cursor paging in milestone 7 (user)

## Assumed

- [x] The query parameters are named `status` and `type`, after the job's own fields - matches the Job entity and the task's wording
- [x] Status and type filters combine with AND (a job must match both); within one filter several values combine with OR - the only reading that makes a combined filter useful
- [x] Without a filter parameter, that filter is not applied (today's behaviour stays) - keeps existing clients working
- [x] An empty value (`status=`) is rejected as `VALIDATION_FAILED` for that field, not read as "no filter" - an empty value is almost always a client bug
- [x] The same value given twice counts once - harmless, no reason to reject it
- [x] Ordering and paging stay as today (newest first, `limit`/`offset` applied to the filtered jobs) - filters narrow the list, nothing else changes

## Open questions

- [x] Can a client ask for several statuses or types at once, and in which form?
- [x] What does `total` count when a filter is given: the matching jobs or all jobs?
- [x] What happens with an unknown status or type value?
- [x] Are filters beyond status and type in scope (priority, creation date range, sort order)?
