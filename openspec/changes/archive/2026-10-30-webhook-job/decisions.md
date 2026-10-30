# Decisions: webhook-job

## Decided

- The change is planned and built on its own branch `webhook-job` (user)
- Scope: job-service only (contracts, validation, storage and API for the `webhook` type); no execution, no UI (user)
- Webhook payload from the design: `method` (POST, PUT or GET), `url`, `body` (JSON) (user, design "Job Queue — UI" SubmitWebhook)
- Execution (later): the simulated call takes 1–2 s and fails 20% of the time to exercise retries (user, concept + design)
- `url` must be an absolute http or https URL; any other scheme is a 400 on `payload.url`; no private-host blocking since nothing is called for real (user)
- `body` is an optional JSON object (may be omitted, e.g. for GET); arrays, strings and other values are rejected (user)
- A completed webhook job returns `{ statusCode, responseBody }`: the simulated HTTP status and a mock response body (user)
- A failed attempt keeps the shared `JobError` `{ code, message, details }`; the HTTP status goes into `details.statusCode`; the attempt number comes from the job's `attempts`, and "retryable" is derived from `attempts < maxAttempts`; no contract change for other types (user)
- The type is named `webhook` in the API and in Postgres; the Prisma `JobType` enum gains it through a new migration (user confirmed assumption)
- An invalid webhook payload returns 400 `VALIDATION_FAILED` with an issue per field (`payload.url`, `payload.method`, ...), like email jobs (user confirmed assumption)
- `method` is upper case only (`POST`, `PUT`, `GET`); `url` is at most 2048 characters (user confirmed assumption)
- No separate webhook body limit: the existing configured request body limit (413 `PAYLOAD_TOO_LARGE`) covers it (user confirmed assumption)
- Result `statusCode` is a 2xx integer and `responseBody` a JSON object; the executor will report code `WEBHOOK_HTTP_ERROR`, job-service stores any non-empty code as today and does not check it (user confirmed assumption)
- After the planning commit: job-management is made type-generic and the email-specific submit and validation rules move into the email-job spec (same scenario names, no behaviour change), mirroring webhook-job (user)

## Assumed

- [x] Result `statusCode` is a 2xx integer (a completed call is a success) and `responseBody` is a JSON object - mirrors the payload body
- [x] The failure code `WEBHOOK_HTTP_ERROR` from the design is the code the executor will report; job-service stores any non-empty code as today and does not check it - error codes of attempts are the executor's concern
- [x] The type is named `webhook` in the API and in Postgres - matches the design's request sample
- [x] Payload validation errors return 400 `VALIDATION_FAILED` with an issue per field (`payload.url`, `payload.method`, ...) - same as email jobs
- [x] `method` is case-sensitive upper case (`POST`, `PUT`, `GET`) - matches the design's select
- [x] The URL limit is 2048 characters - common practical URL limit
- [x] The whole request stays under the existing configured body limit (413 `PAYLOAD_TOO_LARGE`); no separate webhook body limit - one limit for all types
- [x] The Prisma `JobType` enum gains `webhook` through a new migration - jobs table stores the type as an enum

## Open questions

- [x] Which URLs are accepted?
- [x] What may `body` be, and is it required?
- [x] What does a completed webhook job return as its result?
- [x] How is the design's failure error (`status`, `attempt`, `retryable`) carried in the job's `error`?
