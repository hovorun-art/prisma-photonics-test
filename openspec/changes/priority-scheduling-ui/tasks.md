# Tasks

## Plan

```
1 (schedule model, strings, shared types)
├── 2 (submit form)
└── 3 (jobs list and job page)
4 (Playwright e2e, DECISIONS.md, full checks) after 2 and 3
```

Groups 2 and 3 could run in parallel (no shared files); 1 comes first, 4 last.

## 1. Schedule model and shared strings

Owns: `apps/job-ui/src/locales/en.ts`, `apps/job-ui/src/features/jobs/model/run-schedule.ts`,
`apps/job-ui/src/features/jobs/model/local-run-schedule.ts`,
`apps/job-ui/src/features/jobs/model/local-run-schedule.test.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Add the strings to `locales/en.ts`: `submit.scheduledAt` (input label), `submit.scheduleHint(timeZone)`, `submit.errors.scheduleRequired` ("Choose a date and time"), `submit.errors.schedulePast` ("Choose a time in the future"), `submit.errors.scheduleTooFar(days)` ("Choose a time within <n> days"), `job.fields.scheduledFor` ("Scheduled for"); verify `npm run typecheck -w apps/job-ui` passes
- [x] 1.2 Declare the `RunSchedule` port in `model/run-schedule.ts` (`check`, `toRequest`, `message`, `timeZone`, with their Request/Response types and the `JobRun = 'now' | 'later'` type) (design decision 2); verify typecheck passes
- [x] 1.3 Write the failing tests in `local-run-schedule.test.ts` (clock from `mockDeep<Clock>()`): "Immediately" needs no time and sends none; empty time with "At a specific time" is `required` ("No time entered"); a time equal to or before now is `past` ("Time in the past"); a time more than `JOB_LIMITS.scheduledAt.maxAheadDays` days ahead is `tooFar` and its message names the days ("Time too far ahead"); exactly the maximum is accepted; a valid time converts to the same instant as a UTC ISO string, checked once with `process.env.TZ` set to a zone with an offset (restored after); text that is not a date sends no `scheduledAt`; the hint's time zone is the browser's; run them and see them fail
- [x] 1.4 Implement `LocalRunSchedule` in `model/local-run-schedule.ts` (`d: { clock: Clock }`) and verify `npx vitest related --run src/features/jobs/model/local-run-schedule.ts` passes
- [x] 1.5 Run the `test-case-reviewer` subagent on `apps/job-ui/src/features/jobs/model/local-run-schedule.test.ts` (job-ui unit); add the missing cases it reports or note why they belong elsewhere

## 2. Submit form: run choice, validation, preview

Owns: `apps/job-ui/src/features/jobs/model/job-form-draft.ts`,
`apps/job-ui/src/features/jobs/model/run-schedule-form.ts`,
`apps/job-ui/src/features/jobs/model/zod-run-schedule-form.ts` and its `.test.ts`,
`apps/job-ui/src/features/jobs/model/{email,webhook,transit}-form-values.ts`,
`apps/job-ui/src/features/jobs/model/zod-{email,webhook,transit}-job-draft.ts` and their
`*.test.ts`, `apps/job-ui/src/features/jobs/model/email-job-draft.ts`,
`apps/job-ui/src/features/jobs/hooks/use-{email,webhook,transit}-job-draft.ts`,
`apps/job-ui/src/features/jobs/hooks/use-run-schedule.ts`,
`apps/job-ui/src/features/jobs/submit/run-choice.tsx`,
`apps/job-ui/src/features/jobs/submit/job-form.tsx`,
`apps/job-ui/src/features/jobs/submit/submit-job-page.tsx`,
`apps/job-ui/src/features/jobs/submit/request-preview.tsx`,
`apps/job-ui/src/features/jobs/submit/submit-job-page.test.tsx` · Depends on: 1 · Parallel with: 3

- [x] 2.1 Extend `JobFormExecution` with `run` and `scheduledAt` and `JobRequestPreview` with `scheduledAt?` in `job-form-draft.ts` (design decisions 3, 5; moved here from group 1 because the form files that use these types belong to this group), then write the failing tests of the shared `ZodRunScheduleForm` (one wrapper the three drafts use instead of repeating it: the type's request schema and the schedule checked together, so every invalid field shows at once, and the preview values) and the failing draft tests in `zod-{email,webhook,transit}-job-draft.test.ts` (`RunSchedule` from `mockDeep`): the schema leaves `scheduledAt` out for "Immediately", sets it from `toRequest` for "At a specific time", and rejects with an issue on `scheduledAt` when `check` reports a problem; `fieldMessage('scheduledAt')` returns `RunSchedule.message`; an API issue on `scheduledAt` maps to the `scheduledAt` field; `previewRequest` has no `run` and carries `scheduledAt` only when `toRequest` gives one; run them and see them fail
- [x] 2.2 Add `run` and `scheduledAt` to the three form values and `*_FORM_FIELDS`, wrap each draft's schema as in design decision 1, give the drafts `d: { runSchedule }` (transit: with its clock) and build one `LocalRunSchedule` with `SystemClock` in `useRunSchedule`, shared by the `use*JobDraft` hooks and the run choice (for the time zone hint); verify the draft tests pass
- [x] 2.3 Write the failing page tests in `submit-job-page.test.tsx`, named after the scenarios: "Immediately at first", "Choose a specific time", "Submit a scheduled job", "Back to immediately", "No time entered", "Time in the past", "Time too far ahead", "API validation error on the scheduled time", "Preview of a scheduled request", "Run choice is enabled", "Switching keeps the scheduled time" (fake only `Date`) (no existing test expected "At a specific time" disabled, so none needed adjusting); run them and see them fail
- [x] 2.4 Build `submit/run-choice.tsx` (toggle bound to `run`, `datetime-local` input with hint or error), use it in `job-form.tsx` without `ComingSoon`, carry `run` and `scheduledAt` in `SubmitJobPage`'s execution state, and show `status: scheduled` and `scheduledAt` in `RequestPreview`'s example when the request has one; verify the page tests pass with `npx vitest related --run` on the changed files
- [x] 2.5 Run the `test-case-reviewer` subagent on job-ui unit tests `src/features/jobs/model/zod-*-job-draft.test.ts` and `src/features/jobs/submit/submit-job-page.test.tsx`; add the missing cases it reports or note why they belong elsewhere

## 3. Jobs list and job page show the scheduled time

Owns: `apps/job-ui/src/features/jobs/model/job-presenter.ts`,
`apps/job-ui/src/features/jobs/model/job-presenter.test.ts`,
`apps/job-ui/src/features/jobs/model/job-presentation.ts`,
`apps/job-ui/src/features/jobs/hooks/use-job-fields.ts`,
`apps/job-ui/src/features/jobs/details/job-details-list.tsx`,
`apps/job-ui/src/features/jobs/details/job-page.test.tsx`,
`apps/job-ui/src/features/jobs/list/jobs-table.tsx`,
`apps/job-ui/src/features/jobs/list/jobs-list-page.test.tsx`,
`apps/job-ui/src/features/jobs/testing/job-fixtures.ts` · Depends on: 1 · Parallel with: 2

- [ ] 3.1 Write the failing `job-presenter.test.ts` cases: "Lifecycle of a scheduled job", "Lifecycle of a completed scheduled job", "Lifecycle of a job scheduled for a past time" (and that a job without `scheduledAt` keeps today's steps); run them and see them fail
- [ ] 3.2 Implement the lifecycle rule of design decision 6 in `JobPresenter` (and `LifecycleStep`'s status type if needed); verify the presenter tests pass
- [ ] 3.3 Write the failing page tests: in `job-page.test.tsx` "Scheduled time on the job page" and "No scheduled time on the job page"; in `jobs-list-page.test.tsx` "Scheduled job in the list" and "Started scheduled job in the list"; add a scheduled job to `job-fixtures.ts` if needed; run them and see them fail
- [ ] 3.4 Add `scheduledFor` to `useJobFields`, the "Scheduled for" row to `JobDetailsList` (only when set) and the scheduled time under the badge in `JobRow` for status `scheduled`; verify the tests pass with `npx vitest related --run` on the changed files
- [ ] 3.5 Run the `test-case-reviewer` subagent on job-ui unit tests `src/features/jobs/model/job-presenter.test.ts`, `src/features/jobs/details/job-page.test.tsx` and `src/features/jobs/list/jobs-list-page.test.tsx`; add the missing cases it reports or note why they belong elsewhere

## 4. Integration

Owns: `apps/job-ui/test/e2e/jobs.spec.ts`, `DECISIONS.md`, `docs/roadmap/05-reliability.md` · Depends on: 2, 3 · Parallel with: none

- [ ] 4.1 Add a Playwright test "Submit a scheduled job: the new job page shows the scheduled time" to `apps/job-ui/test/e2e/jobs.spec.ts` (mocked API answers with a `scheduled` job; asserts the request's `scheduledAt` and the "Scheduled for" row and Lifecycle) and run it in the main agent with the job-ui Playwright suite
- [ ] 4.2 Record in `DECISIONS.md` (scheduled jobs paragraph) how job-ui schedules: native `datetime-local` in local time chosen over a calendar library (react-day-picker 10.0.2, ~45M weekly downloads) to add no dependency, sent as UTC, checked in the form with the API's rules, with the browser-clock vs job-service-clock trade-off; mark `priority-scheduling-ui` done in the roadmap if the roadmap tracks status
- [ ] 4.3 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`) and the `change-verifier` subagent in the foreground; fix until it returns PASS

## Workflow follow-up

- `/archive priority-scheduling-ui` after PASS, on the change branch, then merge into `master`.
