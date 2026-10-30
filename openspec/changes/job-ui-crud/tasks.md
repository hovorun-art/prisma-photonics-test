# Tasks

## Plan

```
1 Foundation ──┬── 2 App frame ──┐
               ├── 3 Jobs list ──┤
               ├── 4 Job page  ──┼── 6 Integration
               └── 5 Submit    ──┘
```
Groups 2, 3, 4 and 5 could run in parallel after group 1; group 6 runs last, alone.
Paths are relative to `apps/job-ui/` unless they start with a repository folder.

## 1. Foundation

Owns: `package.json`, `package-lock.json` (root), `tooling/eslint/config.mjs`, `vitest.config.ts`,
`src/test-setup.ts`, `src/index.css`, `src/lib/**`, `src/components/ui/**`, `src/config/**`,
`src/locales/**`, `src/features/jobs/api/**`, `src/features/jobs/model/**`,
`src/features/jobs/hooks/use-copy.ts(+test)`, `src/features/jobs/hooks/use-ui-config.ts`,
`src/features/app-frame/coming-soon.tsx(+test)` · Depends on: none · Parallel with: none

- [x] 1.1 Add the dependencies from design.md ("New dependencies") to job-ui and add `apps/job-ui/src/**/use-*.ts` and `apps/job-ui/src/lib/class-names.ts` to `FREE_FUNCTIONS_ALLOWED`; verify `npm install` succeeds and `npm run lint` passes
- [x] 1.2 Replace the theme tokens in `src/index.css` with the design's colours, radii and fonts (bundled `@fontsource` imports), and add the shadcn components (button, badge, card, dialog, tooltip, input, textarea, label, skeleton, alert) and `lib/class-names.ts`; verify `npm run typecheck -w @job-queue/job-ui` and `npm run build -w @job-queue/job-ui` pass
- [x] 1.3 Add `src/test-setup.ts` (jest-dom, `TZ=UTC`, cleanup) wired into the job-ui Vitest project, `config/ui-config.ts` (`UI_CONFIG`, `UiConfigProvider`, `useUiConfig`) and every user-facing string of this change to `locales/en.ts`; verify the existing tests still pass
- [x] 1.4 Write failing `fetch-jobs-api.test.ts` against MSW: query sends `offset` and parses `{ items, total }`; get, create and delete call their routes; an error body becomes `ApiError` with its code; a network failure becomes `ApiError` without a code
- [x] 1.5 Implement `JobsApi`, `FetchJobsApi`, `ApiError` and `JobsApiProvider`/`useJobsApi`; verify 1.4 passes
- [x] 1.6 Write failing `job-presenter.test.ts` for the Details scenarios ("Waiting or running email job", "Completed email job", "Failed email job"), the short id, the list time, the page date-time and total time ("Times on the job page"), and the lifecycle steps ("Lifecycle of a completed job", "Lifecycle of a pending job"); and `curl-builder.test.ts` for the submit and get commands
- [x] 1.7 Implement `JobPresenter`, `CurlBuilder` and `status-style.ts`; verify 1.6 passes
- [x] 1.8 Write failing tests for `useCopy` (writes to the clipboard, reads "Copied" for the configured time, then resets) and `ComingSoon` ("Disabled filter": disabled control, "Coming soon" tooltip on hover and on focus); implement both and verify they pass

## 2. App frame

Owns: `src/features/app-frame/app-frame.tsx`, `src/features/app-frame/app-frame.test.tsx` ·
Depends on: 1 · Parallel with: 3, 4, 5

- [x] 2.1 Write failing tests for "Header on every page" (mark "Queue", "Jobs", "API docs", "New job", pill "API status —"), "New job from the header" and "API docs in a new tab" (link to `/api/docs`, `target=_blank`, `rel=noopener`)
- [x] 2.2 Implement `AppFrame` (header, nav with the active link, disabled health pill, `<Outlet/>` in a 1280px container) and verify 2.1 passes

## 3. Jobs list

Owns: `src/features/jobs/list/**`, `src/features/jobs/hooks/use-jobs-page.ts` · Depends on: 1 ·
Parallel with: 2, 4, 5

- [x] 3.1 Write failing `jobs-list-page.test.tsx` (MSW) for "Jobs in the table", "Open a job from the list", "Loading" and "No jobs"
- [x] 3.2 Implement `useJobsPage`, `JobsListPage`, `JobsTable` (short id link, badge, attempts, details, time, disabled Cancel/Retry or "—") and verify 3.1 passes
- [x] 3.3 Write failing tests for "First page", "Next page" and "Last page"; implement `JobsPager` ("Showing x–y of total", Previous/Next) and verify they pass
- [x] 3.4 Write failing tests for "Status change appears in the list", "API unreachable while polling" and "API back again" (short `pollIntervalMs` through `UiConfigProvider`); implement polling and `LiveIndicator` and verify they pass
- [x] 3.5 Write failing tests for "Statistics without data" and the disabled filters and search in the toolbar; implement `QueueStats` and `JobsToolbar` with `ComingSoon` and verify they pass

## 4. Job page

Owns: `src/features/jobs/details/**`, `src/features/jobs/hooks/use-job.ts`,
`src/features/jobs/hooks/use-delete-job.ts` · Depends on: 1 · Parallel with: 2, 3, 5

- [x] 4.1 Write failing `job-page.test.tsx` (MSW) for "Completed job", "Failed job", "Waiting job", "Lifecycle of a completed job" and "Lifecycle of a pending job"
- [x] 4.2 Implement `useJob`, `JobPage`, `JobHeader`, `JsonCard`, `Lifecycle` and `JobDetailsList`; verify 4.1 passes
- [x] 4.3 Write failing tests for "Loading a job", "Unknown job id", "Malformed job id" (no request made) and "Job deleted while open"; implement `JobNotFound` and the skeleton, and verify they pass
- [x] 4.4 Write failing tests for "Status change appears on the job page", "Copy the payload" and "Copy as cURL"; implement and verify they pass
- [x] 4.5 Write failing tests for "Delete a finished job", "Cancel the confirmation", "No delete for an unfinished job", "Delete rejected" and "Already deleted"; implement `useDeleteJob` and `DeleteJobDialog` and verify they pass

## 5. Submit

Owns: `src/features/jobs/submit/**`, `src/features/jobs/hooks/use-create-job.ts` · Depends on: 1 ·
Parallel with: 2, 3, 4

- [x] 5.1 Write failing `submit-job-page.test.tsx` (MSW) for "Submit a valid email job", "Defaults in the form", "Cancel the form" and "Disabled job types"
- [x] 5.2 Implement `useCreateJob`, `SubmitJobPage`, `JobTypePicker` and `EmailJobForm` (sections 1–3 with the disabled scheduling and idempotency fields) and verify 5.1 passes
- [x] 5.3 Write failing tests for "Invalid email address", "Priority out of range", "Missing subject", "API validation error" and "Other API error"; implement field errors from `CreateEmailJobRequest` and from the API's issues, and the alert; verify they pass
- [x] 5.4 Write failing tests for "Preview follows the form", "Copy cURL" and "Example response"; implement `RequestPreview` and verify they pass

## 6. Integration

Owns: `src/app.tsx`, `src/app.test.tsx`, `src/main.tsx`, `src/features/index.ts`,
`src/features/app-shell/**` (removed), `test/e2e/**`, `tests/system-e2e/job-ui.spec.ts`,
`DECISIONS.md`, `docs/roadmap/02-email-job-crud.md`, `docs/roadmap/04-all-endpoints.md`,
`README.md` · Depends on: 2, 3, 4, 5 · Parallel with: none

- [x] 6.1 Write failing `app.test.tsx` for "Start page is the jobs list", "Direct link to a job" and "Back returns to the list" (memory router, MSW)
- [x] 6.2 Wire routes in `app.tsx` (`/` → `/jobs`, `/jobs`, `/jobs/new`, `/jobs/:id` inside `AppFrame`), providers in `main.tsx`, exports in `features/index.ts`; remove `features/app-shell`; verify 6.1 passes
- [x] 6.3 Replace `test/e2e/app-shell.spec.ts` with Playwright specs against a mocked API (`page.route`): list → job page, Back, submit → job page, delete flow; verify `npm run test:e2e -w @job-queue/job-ui` passes
- [ ] 6.4 Replace the started-page test in `tests/system-e2e/job-ui.spec.ts` with "submit an email job, see it in the list, open its page" on the compose stack; verify `npm run test:e2e` passes
- [x] 6.5 Update `docs/roadmap/02-email-job-crud.md` (intent: lists, shows, submits and deletes jobs) and add `job-update` to `docs/roadmap/04-all-endpoints.md` after `job-list-filters`; add the job-ui entries to `DECISIONS.md` (polling, disabled future elements, client-side validation with the shared schemas) and mention the UI routes in `README.md`
- [ ] 6.6 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`) and verify they pass

## Workflow follow-up

- Run `change-verifier` until it returns PASS, then `/archive job-ui-crud` on this branch.
