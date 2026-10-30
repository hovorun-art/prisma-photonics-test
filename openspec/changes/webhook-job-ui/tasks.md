# Tasks

All paths are under `apps/job-ui/src/features/jobs/` unless they start with `apps/`, `docs/` or `tests/`.

## Plan

```
1 (foundations) ──┬── 2 (list + job page)  ──┐
                  └── 3 (submit page)       ──┴── 4 (integration)
```

Groups 2 and 3 could run in parallel after 1; the user decides whether they do.

## 1. Foundations: strings, fixtures, shared draft pieces

Owns: `apps/job-ui/src/locales/en.ts`, `testing/job-fixtures.ts`, `model/job-form-draft.ts`,
`model/validation-issue-mapper.ts`, `model/validation-issue-mapper.test.ts`,
`model/email-job-draft.ts`, `model/zod-email-job-draft.ts`, `model/zod-email-job-draft.test.ts`,
`model/email-form-values.ts`, `hooks/use-email-job-draft.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Add every new string to `locales/en.ts` (webhook field labels, method options, mock note "Mock target: some calls fail at random, so you can watch retries.", URL and body error messages, `details.webhookWaiting(method, url)`, `details.webhookCompleted(statusCode)`); verify `npm run typecheck -w apps/job-ui` passes
- [x] 1.2 Add `webhookJob()` to `testing/job-fixtures.ts` (ids from `randomUUID()`), mirroring the email builder; verify typecheck passes
- [x] 1.3 Write failing tests in `model/validation-issue-mapper.test.ts`: an issue for a known field maps to that field, an unknown path goes to `unmatched`, details without issues give no errors (the behaviour `ZodEmailJobDraft.apiErrors` has today)
- [x] 1.4 Add `JobFormDraft<Field>` (`model/job-form-draft.ts`, design D3) and `ValidationIssueMapper` (`model/validation-issue-mapper.ts`); make `ZodEmailJobDraft` implement `JobFormDraft` using the mapper; verify 1.3 passes and the existing `zod-email-job-draft.test.ts` and `submit-job-page.test.tsx` stay green unchanged

## 2. Webhook jobs in the list and on the job page

Owns: `model/job-presenter.ts`, `model/job-presenter.test.ts`, `list/jobs-list-page.test.tsx`,
`details/job-page.test.tsx` · Depends on: 1 · Parallel with: 3

- [x] 2.1 Write failing presenter tests "Waiting or running webhook job", "Completed webhook job", "Failed webhook job" in `model/job-presenter.test.ts`
- [x] 2.2 Make `JobPresenter.details()` switch on `job.type` (design D6); verify 2.1 and the email detail tests pass
- [x] 2.3 Write list component tests for the same three scenarios in `list/jobs-list-page.test.tsx` (MSW answering webhook jobs) and verify they pass
- [x] 2.4 Write job page tests "Completed webhook job page" and "Failed webhook job page" in `details/job-page.test.tsx`; fix anything that keeps them from passing; verify they pass

## 3. Webhook on the submit page

Owns: `submit/submit-job-page.tsx`, `submit/submit-job-page.test.tsx`, `submit/job-form.tsx`
(new, replaces `submit/email-job-form.tsx`), `submit/email-payload-fields.tsx`,
`submit/webhook-payload-fields.tsx`, `submit/job-type-picker.tsx`, `submit/request-preview.tsx`,
`model/webhook-form-values.ts`, `model/zod-webhook-job-draft.ts`,
`model/zod-webhook-job-draft.test.ts`, `hooks/use-webhook-job-draft.ts`, `model/curl-commands.ts`
(added during apply: the submit command takes the preview request) · Depends on: 1 ·
Parallel with: 2

- [x] 3.1 Split `email-job-form.tsx` into `job-form.tsx` (shell, generic over `JobFormDraft`) and `email-payload-fields.tsx` with no behaviour change (design D3); verify every existing `submit-job-page.test.tsx` test stays green
- [x] 3.2 Write failing tests in `model/zod-webhook-job-draft.test.ts` for the form schema: valid values give a `CreateWebhookJobRequest` with the body parsed; blank body gives no `body`; `ftp://` URL, empty URL, too-long URL, invalid JSON and `[1, 2]` body are rejected on their field with job-ui's messages; `previewRequest` follows the text
- [x] 3.3 Implement `model/webhook-form-values.ts`, `model/zod-webhook-job-draft.ts` (design D4, D5) and `hooks/use-webhook-job-draft.ts`; verify 3.2 passes
- [x] 3.4 Write failing page tests "Choose Webhook", "Direct link to the webhook form", "Back to the previous type", "Switching keeps the execution settings" and the modified "Disabled job types"
- [x] 3.5 Implement the type from the URL (design D1), the keyed per-type form with lifted execution values (D2) and the picker's `selected`/`onSelect` with Webhook enabled; verify 3.4 passes
- [x] 3.6 Write failing page tests "Submit a valid webhook job", "Submit without a body", "Webhook form at first", "Invalid webhook URL", "Missing webhook URL", "Body is not valid JSON", "Body is not a JSON object", "API validation error on a webhook field"
- [x] 3.7 Implement `webhook-payload-fields.tsx` (Method select + URL row, monospace Body (JSON) textarea, amber mock note, as in design SubmitWebhook); verify 3.6 passes
- [x] 3.8 Write failing page tests "Preview of a webhook request" and "Example response for a webhook job"; make `RequestPreview` take the draft's preview request (design D5); verify they and the existing preview tests pass

## 4. Integration

Owns: `apps/job-ui/test/e2e/jobs.spec.ts`, `docs/roadmap/03-all-job-types.md`, `DECISIONS.md` ·
Depends on: 2, 3 · Parallel with: none

- [x] 4.1 Extend `apps/job-ui/test/e2e/jobs.spec.ts` with "Submit a valid webhook job" (choose Webhook, fill method, URL and body, submit, the job page shows the webhook payload) against the routed mock API; verify the job-ui Playwright suite passes
- [x] 4.2 Add the `webhook-job-ui` row to `docs/roadmap/03-all-job-types.md` after `webhook-job`; record the shared form shell and JSON-body-as-text choice in `DECISIONS.md`
- [x] 4.3 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`) and the job-ui Playwright suite; verify all pass

## Workflow follow-up

- Run the `change-verifier` subagent and get PASS before archiving.
- `/archive webhook-job-ui` on this branch, then merge into `master` with the user's approval.
