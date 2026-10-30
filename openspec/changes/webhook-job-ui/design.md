# Design

## Context

See proposal.md (Why) and `specs/job-ui/spec.md` (requirements). Relevant current state of
`apps/job-ui/src/features/jobs/`:

- `submit/submit-job-page.tsx` owns one `react-hook-form` form typed as `EmailFormValues`
  (= `z.input<CreateEmailJobRequest>`) with `zodResolver(CreateEmailJobRequest)`, and passes the
  watched values to `submit/request-preview.tsx`.
- `submit/email-job-form.tsx` renders the whole form (type picker, payload, execution, buttons) and
  owns submit and API-error mapping through `EmailJobDraft` (`model/zod-email-job-draft.ts`), which
  is email-specific (its field list and messages).
- `submit/job-type-picker.tsx` shows Email selected and Webhook/Transit wrapped in `ComingSoon`.
- `model/job-presenter.ts` `details()` reads `job.payload.to` / `job.result.messageId` for every job.
- Contracts already have `CreateWebhookJobRequest`, `WebhookJobPayload`, `WebhookJobResult`,
  `WEBHOOK_METHODS`, `WEBHOOK_LIMITS`, `JsonObject`; `Job` is a discriminated union on `type`.

## Goals / Non-Goals

**Goals:**
- One submit page that serves both types without copying the email form's submit and error logic.
- Form validation from the shared contract schemas, as for email.

**Non-Goals:**
- No change to job-service, job-execution-service or the contracts' API shapes.
- No webhook-specific job page card (decided: the JSON cards are enough).
- No new system e2e.

## Decisions

### D1. Type from the URL with `useSearchParams`
`SubmitJobPage` reads `type` from `useSearchParams()` (`webhook` → webhook, anything else → email)
and the cards call `setSearchParams` (push, so Back returns to the previous type). The picker gets
`selected` and `onSelect` props; the Webhook card loses its `ComingSoon` wrapper.
*Alternative:* local state only (rejected by the user: no shareable link), separate routes
(rejected by the user).

### D2. One form per type, keyed by type
`SubmitJobPage` renders a `JobForm` for the selected type with `key={type}`, so switching remounts
the form and the payload starts empty. Priority and Max attempts survive the switch by being lifted
into page state (`execution`) that seeds the new form's `defaultValues` and is updated by a
`useWatch` on those two fields.
*Alternative:* one form with a union of values and `unregister` on switch: messier typing in
`react-hook-form` and harder to keep the per-type resolver.

### D3. Shared form shell, per-type payload fields
Split `email-job-form.tsx` into:
- `submit/job-form.tsx`: the shell (sections, picker, execution fields, alert, buttons, submit,
  API error mapping), generic over a `JobFormDraft` for the type.
- `submit/email-payload-fields.tsx` and `submit/webhook-payload-fields.tsx`: the "2. Payload"
  fields of each type (webhook: Method select + URL row, monospace Body (JSON) textarea, amber note).

The draft interface generalises today's `EmailJobDraft` to `JobFormDraft<Field>`: `fields`,
`emptyValues`, `schema` (the form's resolver schema), `fieldMessage` and `apiErrors`.
`ZodEmailJobDraft` keeps its behaviour; a new `ZodWebhookJobDraft` implements it for webhook. The
API-error mapping (`apiErrors`: issue path → form field or "unmatched") is identical for both, so it
moves into one class `ValidationIssueMapper` (`model/validation-issue-mapper.ts`) that both drafts
use, instead of being written twice.

### D4. Body (JSON) as text, parsed by the form schema
The textarea holds a string, so the webhook form values are
`{ type: 'webhook', payload: { method, url, body: string }, priority, maxAttempts }`. The webhook
form schema is built from the contract pieces: `method` = `z.enum(WEBHOOK_METHODS)`, `url` =
`WebhookJobPayload.shape.url`, and `body` = a string `transform` that returns `undefined` for blank
text, otherwise `JSON.parse` (an invalid parse adds a `custom` issue) piped into `JsonObject`. The
output is then checked with `CreateWebhookJobRequest`, so what is sent is exactly what the API
accepts. Field messages: URL ("Enter an absolute http or https URL" / too long with the limit),
body ("Body must be valid JSON" / "Body must be a JSON object").

### D5. Preview from form values through the draft
`RequestPreview` takes the request to show (a `CreateJobRequest`-shaped object) instead of
`EmailFormValues`. The page converts the watched values with the draft's `previewRequest` (for
webhook: body text parsed when it is a valid JSON object, left out when blank, shown as the raw
string otherwise so the preview still follows typing). The example response uses `request.type`,
as it already does.

### D6. Presenter switches on `job.type`
`JobPresenter.details()` narrows by `job.type` first: email keeps today's texts; webhook gives
`en.details.webhookWaiting(method, url)` ("POST https://…"), `en.details.webhookCompleted(status)`
("HTTP 200") and the error message. TypeScript's union narrowing makes the email branch type-safe
again.

### D7. Tests
Component tests with MSW in `submit-job-page.test.tsx`, `jobs-list-page.test.tsx` and
`job-page.test.tsx` for the new scenarios; unit tests for `ZodWebhookJobDraft`,
`ValidationIssueMapper` and the presenter's webhook details; the job-ui Playwright suite
(`test/e2e/jobs.spec.ts`) gains "submit a webhook job" against its routed mock API. Fixtures get a
`webhookJob()` builder in `testing/job-fixtures.ts`.

## Risks / Trade-offs

- [Refactoring the email form while adding webhook could change email behaviour] → the existing
  email tests stay unchanged and must stay green; the split happens first, with no behaviour change,
  before webhook code is added.
- [The preview shows a non-JSON body as a string, unlike what will be sent] → it only happens while
  the field is invalid, and submit is blocked then.
- [`webhook-job-execution` is not merged yet] → the UI is driven by the job JSON only; until the
  worker merges, real webhook jobs stay `pending`, which the UI already shows. Tests use fixtures.
