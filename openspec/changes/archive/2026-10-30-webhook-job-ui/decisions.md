# Decisions: webhook-job-ui

## Decided

- Scope: job-ui support for webhook jobs (submit, list, job page); built on its own branch `webhook-job-ui`, in parallel with `webhook-job-execution` (user)
- The visual design is the user's Claude Design project (artifact `2c72083e-7fe0-4c29-a748-b0672b62866e`), screen SubmitWebhook: Method select (POST, PUT, GET) and URL on one row, a "Body (JSON)" monospace textarea, an amber note about the mock target's failures; the rest of the page as on SubmitJob (user, design SubmitWebhook)
- On the submit page the type cards switch the form in place; choosing Webhook puts the type in the URL (`/jobs/new?type=webhook`) so the link can be shared and Back works; `/jobs/new` shows Email (user)
- Body (JSON): empty or whitespace sends no `body`; text that is not valid JSON, or JSON that is not an object (array, string, number), shows a red error under the field and nothing is sent (user)
- Details column for a webhook job: "<METHOD> <url>" while waiting or running, "HTTP <statusCode>" when completed, the error message when failed (user)
- The mock note gives no number: "Mock target: some calls fail at random, so you can watch retries." (user)
- Webhook fields follow the shared contract: methods POST, PUT, GET; an absolute http(s) URL within the contract's length limit; the body optional and, when given, a JSON object (user confirmed assumption)
- The webhook form opens with method POST and an empty URL and body, like the email form opens empty (user confirmed assumption)
- The job page needs no webhook-specific card: the Payload, Result (`statusCode`, `responseBody`) and Error (code, message, `details.statusCode`) cards show the JSON as for email, and the failed-job alert shows the error message (user confirmed assumption)
- Execution settings (Priority, Max attempts), Cancel, "Submit job" and opening the new job's page after submit work for webhook exactly as for email (user confirmed assumption)
- Aircraft transit stays disabled with "Coming soon"; the idempotency key and "At a specific time" stay disabled (user confirmed assumption)
- Switching the type keeps Priority and Max attempts; each type's payload fields start empty (user confirmed assumption)
- All new strings go into `locales/en.ts` (user confirmed assumption)
- Roadmap milestone 3 gains a `webhook-job-ui` row after `webhook-job` (user confirmed assumption)
- Tests: component tests (MSW) for every spec scenario, plus the job-ui Playwright e2e (mocked API) extended with submitting a webhook job; no new system e2e (user)

## Assumed

- [x] Webhook fields follow the shared contract: methods POST, PUT, GET; an absolute http(s) URL within the contract's length limit; the body optional and, when given, a JSON object - fixed by `webhook-job`
- [x] The webhook form opens with method POST and an empty URL and body, like the email form opens empty - consistent with email
- [x] The job page needs no webhook-specific card: the Payload, Result (`statusCode`, `responseBody`) and Error (code, message, `details.statusCode`) cards show the JSON as for email, and the failed-job alert shows the error message - the existing cards already show any JSON
- [x] Execution settings (Priority, Max attempts), Cancel, "Submit job" and opening the new job's page after submit work for webhook exactly as for email - same flow
- [x] Aircraft transit stays disabled with "Coming soon"; the idempotency key and "At a specific time" stay disabled - their changes come later
- [x] Switching the type keeps Priority and Max attempts; each type's payload fields start empty - the execution section is shared
- [x] All new strings go into `locales/en.ts` - project rule
- [x] Roadmap milestone 3 gains a `webhook-job-ui` row after `webhook-job` - keeps the roadmap honest

## Open questions

- [x] How does the user switch between Email and Webhook on the submit page, and is the chosen type in the URL?
- [x] What happens to the Body (JSON) field when it is empty, or holds text that is not a JSON object?
- [x] What does the Details column of the jobs list show for a webhook job (waiting/running, completed, failed)?
- [x] The design's note says "fails 20% of the time", but the failure rate is a worker setting: what does the note say?
- [x] Tests: component tests as usual; what about the job-ui Playwright e2e and the system e2e for webhook?
