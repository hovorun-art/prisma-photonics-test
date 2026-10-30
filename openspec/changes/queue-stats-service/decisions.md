# Decisions: queue-stats-service

## Decided

- One change for both the statistics API in job-service and its display in job-ui (user)
- The statistics fill the six existing cards on the jobs list (Pending, Processing, Scheduled, Completed · 24h, Failed · 24h, Throughput) (user, existing design)
- The statistics are served by a separate public route `GET /v1/stats`; `GET /health` stays a plain liveness check of its own process (user)
- The numbers come from job state in Postgres (the source of truth), not from BullMQ/Redis (user)
- Throughput is the number of jobs completed in the last configured window (default 5 minutes), shown as jobs per minute (user)
- "Completed · 24h" and "Failed · 24h" count jobs in status completed / failed that finished within a rolling window ending now (default 24 hours, in config) (user)
- The "API status" header pill becomes live from the statistics poll: "API online" while it succeeds, "API offline" when it fails (user)
- job-ui refreshes the statistics at the same configured interval as the jobs list (`pollIntervalMs`) (user)
- The statistics response is a Zod schema in `packages/contracts`, validated by job-ui like the other API responses (user confirmed assumption)
- The endpoint is public (no service token), like `GET /v1/jobs` (user confirmed assumption)
- Pending, Processing and Scheduled are current counts over all job types; there is no type or status filter on `GET /v1/stats` (user confirmed assumption)
- When Postgres cannot be reached, `GET /v1/stats` answers like the other routes (generic HTTP 500 `INTERNAL_ERROR`) (user confirmed assumption)
- The cards keep their current order, labels and status colours (user confirmed assumption)
- While the first statistics request is loading, the cards show skeletons; when a later poll fails, the last numbers stay and the pill turns "API offline" (user confirmed assumption)
- Counts are formatted with thousands separators (`1,234`), throughput with one decimal and the unit (`2.4/min`) (user confirmed assumption)
- When the first statistics request fails, each card shows "—" until a poll succeeds; the rest of the jobs list works normally and the pill reads "API offline" (user)
- `GET /v1/stats` and its response schema are listed in job-service's OpenAPI docs, like every public route (user)
- Until the first statistics request answers, the header pill reads "API status —" (the existing neutral text) (user)

## Assumed

- [x] The statistics response is a Zod schema in `packages/contracts`, validated by job-ui like the other API responses - same as every other route
- [x] The endpoint is public (no service token), like `GET /v1/jobs` - the UI calls it from the browser
- [x] Pending, Processing and Scheduled are current counts over all job types; there is no type or status filter on `GET /v1/stats` - the cards show the whole queue
- [x] When Postgres cannot be reached, `GET /v1/stats` answers like the other routes (generic HTTP 500 `INTERNAL_ERROR`) - no new error code for one read route
- [x] The cards keep their current order, labels and status colours - already designed and in the locales
- [x] While the first statistics request is loading, the cards show skeletons; when a later poll fails, the last numbers stay and the pill turns "API offline" - matches the jobs list behaviour
- [x] Counts are formatted with thousands separators (`1,234`), throughput with one decimal and the unit (`2.4/min`) - readability

## Open questions

- [x] Which route serves the statistics?
- [x] Where do the numbers come from: job state in Postgres, the BullMQ queue in Redis, or both?
- [x] How is "Throughput" defined?
- [x] Is the "API status" header pill made live in this change?
- [x] How often does the UI refresh the statistics?
- [x] Are the 24h cards a rolling window or a calendar day?
- [x] What do the cards show when the first statistics request fails?
- [x] Is the statistics route part of the OpenAPI docs?
- [x] What does the header pill read before the first statistics answer?
