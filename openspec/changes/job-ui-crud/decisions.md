# Decisions: job-ui-crud

## Decided

- Built in its own worktree on branch `job-ui-crud`, from `master`, in parallel with `email-job-execution` (user)
- The visual design comes from the user's Claude Design project (artifact `2c72083e-7fe0-4c29-a748-b0672b62866e`); this change uses the screens Main, JobDetail, SubmitJob and Components; Webhook, Transit and Batch belong to later changes (user)
- Look and feel from the design: light ground `#F7F7F5`, white surfaces with `#E6E6E3` borders and 12px card radius, ink `#17171A`, secondary text `#5C5C63`, accent `#1F3FC4`; Inter for UI text, JetBrains Mono for ids, numbers and JSON; content width up to 1280px (user, design Components)
- Status badges with one colour pair each: scheduled violet, pending amber, processing blue, completed green, failed red, cancelled grey (user, design Components)
- Header: product mark "Queue", navigation with "Jobs" and "API docs", a primary "New job" button on the right (user, design Main)
- Jobs list: a table with columns Job ID, Type, Status, Priority, Attempts, Details, Created, Actions; Job ID links to the job's page; Previous/Next paging with "Showing x of total" (user, design Main)
- Job page: breadcrumb "Jobs / <id>", the id as title with status and type badges, an alert box for a failed job, Payload and Error (or Result) cards with Copy buttons, and a Details list (type, priority, attempts, created, started, finished, total time) (user, design JobDetail)
- Submit page: breadcrumb "Jobs / New job", sections "1. Job type", "2. Payload" (To, subject, Body), "3. Execution" (Priority, Max attempts), Cancel and "Submit job" buttons; inputs show errors in red under the field (user, design SubmitJob, Components)
- The list and job page refresh by polling (user, design Main: "Updates every 2 s via polling"); the interval is a config value, 2s by default
- Design elements whose API does not exist yet (status/type filters with counts, search, Cancel/Retry, queue statistics cards, health and workers pill, idempotency key, "Run at a specific time", progress bars) are laid out now as in the design but disabled; each later change enables its part (user)
- Built now although no new API is needed: the Lifecycle timeline on the job page (from status and timestamps), the live request/response preview with "Copy cURL" on the submit page, "Copy as cURL" on the job page, and the Webhook and Aircraft transit cards on the submit page shown disabled until their changes (user)
- No edit in this change: no public update route yet, job-management is unchanged; edit is added later in its own change (user; replaces the earlier "add public update")
- When edit is added later, it is an "Edit" button in the job page header that opens `/jobs/:id/edit`, the submit form prefilled with a "Save changes" button (user)
- Disabled "not built yet" elements look muted and show a "Coming soon" tooltip on hover and focus; statistics cards show "—" instead of numbers; the health pill reads "API status —" (user)
- Real URLs through a router: `/jobs` (list, also the start page), `/jobs/new`, `/jobs/:id`; links can be shared and Back works (user)
- After a successful submit the UI opens the new job's page (user)
- Delete: a danger-style "Delete job" button in the job page header, only for finished jobs, behind a confirmation dialog; after deleting, the UI goes back to the list (user)
- Field values follow the shared contract where the design differs: the email field is "Subject" (design: "Title"), priority 1–10 (design: 0–10), ids are UUIDs (design: `j_xxx`) (user confirmed assumption)
- The list shows a short id (first 8 characters of the UUID, monospace); the job page shows the full id (user confirmed assumption)
- The Details column for an email job: "to <address> · "<subject>"" while waiting or running, the message id when completed, the error message when failed (user confirmed assumption)
- Page size of the list is the API's default limit; Previous is disabled on the first page and Next on the last (user confirmed assumption)
- Times in the list are local `HH:mm:ss`; on the job page local date and time ("29 Oct, 21:02:09") and "Total time" from started to finished (user confirmed assumption)
- The submit form is validated in the browser with the shared Zod schemas before sending; an API `VALIDATION_FAILED` answer is shown on the matching fields, any other API error as an alert above the buttons (user confirmed assumption)
- Loading: skeleton rows in the list and skeleton cards on the job page; empty list: "No jobs yet" with a "New job" button; unknown job id: a "Job not found" message with a link back to Jobs (user confirmed assumption)
- If polling fails, the last data stays on screen with a small "Connection lost, retrying" note next to the live indicator (user confirmed assumption)
- "API docs" opens job-service's Swagger page (`/api/docs`) in a new tab (user confirmed assumption)
- Fonts are bundled with the app (`@fontsource/inter`, `@fontsource/jetbrains-mono`), not loaded from Google Fonts (user confirmed assumption)
- Light theme only; layout follows the design's wrapping (the table scrolls horizontally on narrow screens) (user confirmed assumption)
- Roadmap: `02-email-job-crud.md` intent becomes "lists, shows, submits and deletes jobs", and a new `job-update` change (public update + the edit page) is added to milestone 4 after `job-list-filters` (user confirmed assumption)
- No "Edit" button in this change, not even disabled (user confirmed assumption)
- Every user-facing string goes into `locales/en.ts` (user confirmed assumption)
- Tests: component tests with MSW for each screen state, a job-ui Playwright e2e against mocked API, and one system e2e on the compose stack (submit an email job, see it in the list, open it); the "see it completed" step is added by whichever of this change and `email-job-execution` merges second (user confirmed assumption)
- If deleting fails, the confirmation dialog stays open and shows the API's error message; if the job is already gone (`JOB_NOT_FOUND`), the UI goes back to the list as after a successful delete (user)
- A job page URL whose id is not a UUID shows the same "Job not found" message without calling the API; a job that disappears while its page is open also shows "Job not found" (user)
- The Response box of the submit page shows an example `201 Created` body built from the form values (status pending, attempts 0), marked as an example, with placeholder id and times (user)
- Copy buttons (Payload, Error/Result, Copy cURL, Copy as cURL) confirm by changing their label to "Copied" for a moment (user)

## Assumed

- [x] Field values follow the shared contract where the design differs: the email field is "Subject" (design: "Title"), priority 1–10 (design: 0–10), ids are UUIDs (design: `j_xxx`) - the API is fixed by `job-api`; the design's sample data was illustrative
- [x] The list shows a short id (first 8 characters of the UUID, monospace); the job page shows the full id - UUIDs are too wide for the design's 130px column
- [x] The Details column for an email job: "to <address> · "<subject>"" while waiting or running, the message id when completed, the error message when failed - the design shows that per-status detail
- [x] Page size of the list is the API's default limit; Previous is disabled on the first page and Next on the last - matches the design's paging footer
- [x] Times in the list are local `HH:mm:ss`; on the job page local date and time ("29 Oct, 21:02:09") and "Total time" from started to finished - as in the design
- [x] The submit form is validated in the browser with the shared Zod schemas before sending; an API `VALIDATION_FAILED` answer is shown on the matching fields, any other API error as an alert above the buttons - inputs-with-error style is in the design
- [x] Loading: skeleton rows in the list and skeleton cards on the job page; empty list: "No jobs yet" with a "New job" button; unknown job id: a "Job not found" message with a link back to Jobs - states the design does not show
- [x] If polling fails, the last data stays on screen with a small "Connection lost, retrying" note next to the live indicator - the design has a live indicator but no error state
- [x] "API docs" opens job-service's Swagger page (`/api/docs`) in a new tab - the design has the link; Swagger is already served
- [x] Fonts are bundled with the app (`@fontsource/inter`, `@fontsource/jetbrains-mono`), not loaded from Google Fonts - works offline and in the compose stack
- [x] Light theme only; layout follows the design's wrapping (the table scrolls horizontally on narrow screens) - the design shows only light at 1440px wide
- [x] Roadmap: `02-email-job-crud.md` intent becomes "lists, shows, submits and deletes jobs", and a new `job-update` change (public update + the edit page) is added to milestone 4 after `job-list-filters` - keeps the roadmap honest about where edit went
- [x] No "Edit" button in this change, not even disabled - edit is not in the design, so there is nothing to lay out yet
- [x] Every user-facing string goes into `locales/en.ts` - project rule
- [x] Tests: component tests with MSW for each screen state, a job-ui Playwright e2e against mocked API, and one system e2e on the compose stack (submit an email job, see it in the list, open it); the "see it completed" step is added by whichever of this change and `email-job-execution` merges second - project test levels; the worker is built in parallel

## Open questions

- [x] Design elements that need API features not built yet (status/type filters with counts, search, Cancel/Retry buttons, queue statistics cards, "API healthy · workers" pill, idempotency key, "Run at a specific time", progress bars): leave them out until their own change, show them disabled, or build them now with fake data?
- [x] Design elements that need no new API (job-type cards for Webhook and Aircraft transit on the submit page, the live request/response preview with "Copy cURL", "Copy as cURL" on the job page, the Lifecycle timeline built from the job's timestamps): build now or later?
- [x] The roadmap intent says the UI "edits" jobs, but `job-api` decided there is no public field update: drop "edit" from this change and the roadmap, or add a public update route (which fields, in which statuses)?
- [x] Delete is not in the design: where does it go (job page header, list row action, both) and does it ask for confirmation first?
- [x] After a successful submit: open the new job's page, or go back to the list?
- [x] Routing: real URLs (`/jobs`, `/jobs/new`, `/jobs/:id`) with a router library, so links can be shared and the back button works, or a single page without URLs?
- [x] Public update: which fields can a client change (priority, max attempts, payload), in which statuses, and through which route?
- [x] Edit in the UI: a separate edit page reusing the submit form, or inline editing on the job page?
- [x] Disabled elements: how are they marked (a "Coming soon" tooltip, a muted look only), and what do the statistics cards show without data?
- [x] Deleting fails (the job was already deleted, or any other API error): what does the UI show?
- [x] The job page URL holds an id that is not a UUID (`/jobs/abc`), or the job disappears while its page is open: what does the page show?
- [x] The Response box of the submit page's request preview: what does it show before anything is sent?
- [x] Copy buttons (Payload, Error/Result, Copy cURL, Copy as cURL): do they confirm the copy?

## Workflow

- Planning artifacts are not committed before implementation; groups are implemented sequentially (user)
