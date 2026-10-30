# Decisions: job-list-filters-ui

## Decided

- job-ui filter controls on the jobs list for status and type, using the job-service filters
  from `job-list-filters-service` (user, roadmap)
- Each filter selects one value at a time: All or exactly one status, All or exactly one type (user)
- The chosen filters are kept in the URL (`/jobs?status=failed&type=webhook`): a filtered list can be shared, survives a reload, and Back restores the previous filter (user)
- The filter buttons show counts, added in this change (user)
- Counts are faceted: status counts respect the chosen type, type counts respect the chosen status, so a button's count equals the rows clicking it would show (user)
- The counts are part of the statistics route `GET /v1/stats` (from `queue-stats-service`), not of the job list response (user)
- `GET /v1/stats` takes optional `status` and `type` parameters and answers with a `counts` part (per status under the type filter, per type under the status filter); the six statistics cards stay unfiltered as before; without parameters the counts cover all jobs (user)
- The "All" buttons show a count too: all jobs under the other filter (user)
- One change for the counts API in job-service, the contracts and the UI; the roadmap intent of `job-list-filters-ui` is updated to say so (user)
- `queue-stats-service` is finished, archived and merged into master first; this branch is rebased on master before `/apply` (user)
- One system e2e scenario: jobs of two types are submitted, the list is filtered by type in the UI and shows only matching rows (user)
- Search by job id or idempotency key stays disabled with "Coming soon"; it needs an API this change does not add (user confirmed assumption)
- Changing a filter returns the list to its first page (user confirmed assumption)
- The empty state for filters reads "No jobs match these filters" with a "Clear filters" button that resets both filters to All, instead of "No jobs yet" (user confirmed assumption)
- The type filter shows only the job types that exist (Email, Webhook, Aircraft transit); the "Batch" button is removed until the batch job type is built (user confirmed assumption)
- The status buttons keep the design's labels (All, Scheduled, Pending, Processing, Completed, Failed, Cancelled) (user confirmed assumption)
- Polling keeps running with the filters applied, and a failed poll keeps the last filtered page and the last counts as today (user confirmed assumption)
- An unknown `status` or `type` value in the page URL is ignored (treated as All) rather than sent to the API (user confirmed assumption)
- `GET /v1/stats` validates `status` and `type` exactly like `GET /v1/jobs`: one value each from the job's enums, an unknown or empty value answers HTTP 400 `VALIDATION_FAILED`; only one value per filter, since the UI selects one (user confirmed assumption)
- Counts are counts of all jobs in Postgres matching the filter, over all time (not the 24h window of the cards); a value with no jobs shows 0 (user confirmed assumption)
- While the first statistics request loads, the buttons show no count; when it fails, they show no count and the filters still work (user confirmed assumption)
- Counts use the same thousands-separator format as the statistics cards (user confirmed assumption)
- `GET /v1/stats` with a filter given more than once (e.g. `status` twice) answers HTTP 400 `VALIDATION_FAILED` with an issue for that field (user)
- A filter button shows its count as a muted number after the label, inside the button ("Failed 12") (user)
- When a filter changes, the statistics cards keep their last values, and the filter buttons show no count until the counts for the new filters arrive (user)

## Assumed

- [x] Search by job id or idempotency key stays disabled with "Coming soon"; it needs an API this change does not add - out of the roadmap item's scope
- [x] Changing a filter returns the list to its first page - the old offset may lie past the end of the filtered list
- [x] The empty state for filters reads "No jobs match these filters" with a "Clear filters" button that resets both filters to All, instead of "No jobs yet" - "No jobs yet" would be wrong when jobs exist
- [x] The type filter shows only the job types that exist (Email, Webhook, Aircraft transit); the "Batch" button is removed until the batch job type is built - a filter for a type the API rejects would fail with 400
- [x] The status buttons keep the design's labels (All, Scheduled, Pending, Processing, Completed, Failed, Cancelled) - already in the layout and locales
- [x] Polling keeps running with the filters applied, and a failed poll keeps the last filtered page and the last counts as today - filters change only what is asked for
- [x] An unknown `status` or `type` value in the page URL is ignored (treated as All) rather than sent to the API - a hand-edited link should not break the page
- [x] `GET /v1/stats` validates `status` and `type` exactly like `GET /v1/jobs`: one value each from the job's enums, an unknown or empty value answers HTTP 400 `VALIDATION_FAILED`; only one value per filter, since the UI selects one - consistent errors across routes
- [x] Counts are counts of all jobs in Postgres matching the filter, over all time (not the 24h window of the cards); a value with no jobs shows 0 - matches the list's `total`
- [x] While the first statistics request loads, the buttons show no count; when it fails, they show no count and the filters still work - counts are an extra, never a blocker
- [x] Counts use the same thousands-separator format as the statistics cards - consistency

## Open questions

- [x] Does each filter select one value at a time (All or one status), or can several be selected at once (e.g. Failed + Cancelled)?
- [x] Are the chosen filters kept in the URL (`/jobs?status=failed&type=webhook`), so the filtered list can be shared and survives a reload and Back?
- [x] The design shows counts on the filter buttons; the API has no counts per status or type. Show no counts, or add them now?
- [x] Is a filter scenario added to the system e2e (full compose stack), or are the job-ui unit and Playwright tests enough?
- [x] What does a filter button's count count (faceted or over all jobs)?
- [x] Where does job-service serve the counts?
- [x] Does the "All" button show a count?
- [x] One change or split into a service change and a UI change?
- [x] How does `GET /v1/stats` get the filters for faceted counts?
- [x] How does this change build on the unmerged `queue-stats-service`?
- [x] What does `GET /v1/stats` answer when a filter is given more than once?
- [x] How is the count shown on a filter button?
- [x] What do the cards and counts show while the statistics for new filters load?
