# Design

## Context

The API side is done (`priority-scheduling`): `CreateJobRequest.scheduledAt` is an optional ISO 8601
timestamp with an offset, at most `JOB_LIMITS.scheduledAt.maxAheadDays` ahead, and every `Job` has
`scheduledAt: string | null`. A future time creates the job `scheduled`; the worker then moves it
`scheduled` -> `processing` directly.

In job-ui each job type has a `JobFormDraft` (`ZodEmailJobDraft`, `ZodWebhookJobDraft`,
`ZodTransitJobDraft` in `features/jobs/model/`): its form values (named by request paths), the Zod
schema the form is resolved with, its field messages, the API issue mapping and the request preview.
The "Run" toggle in `submit/job-form.tsx` is a static mock wrapped in `ComingSoon`.
`SubmitJobPage` keeps `JobFormExecution` (priority, max attempts) in state so a type switch keeps it.
`JobPresenter` builds the Lifecycle steps and formats times; `useJobFields` feeds the Details list.
Unit tests run with `TZ=UTC` (`src/test-setup.ts`).

## Goals / Non-Goals

**Goals:**
- One implementation of the schedule rules (required, in the future, within the maximum) and of the
  local -> UTC conversion, shared by the three drafts.
- The time the form shows, the time it checks and the time it sends are the same instant.

**Non-Goals:**
- No change to `packages/contracts` or any backend.
- No date picker library (decided: native `datetime-local`).
- No change to the transit report's Job card (it keeps its fields; only the job page's Details
  list gains "Scheduled for").
- No new system e2e: the API scheduling flow is already covered there; the UI flow is covered by
  job-ui's Playwright e2e with a mocked API.

## Decisions

**1. Form values carry `run` and `scheduledAt` (local text); the schema turns them into the request.**
Each draft's form values gain `run: 'now' | 'later'` and `scheduledAt: string` (the
`datetime-local` value, `YYYY-MM-DDTHH:mm`, empty at first). The field name `scheduledAt` matches
the request path, so the existing `ValidationIssueMapper` puts an API issue on `scheduledAt` under
the input without new code; `scheduledAt` joins each draft's `*_FORM_FIELDS`. `run` is not a
request field and never reaches the mapper.
The draft's schema becomes: form object -> `superRefine` with the schedule rules (only when
`run === 'later'`) -> `transform` that drops `run` and sets `scheduledAt` to the UTC ISO string or
removes it -> the contract schema. The email draft, which today hands the contract schema over
directly, gets the same wrapper. Alternative: a separate form state outside react-hook-form for the
schedule; rejected because errors, submit blocking and API issue mapping would have to be rebuilt.

**2. A shared `RunSchedule` port in `model/` with `LocalRunSchedule` as its implementation.**
`RunSchedule` (interface, `model/run-schedule.ts`) with
- `check(req: { run, scheduledAt }) -> { problem: 'required' | 'past' | 'tooFar' | null }`,
- `toRequest(req: { run, scheduledAt }) -> { scheduledAt: string | undefined }` (UTC ISO, or none
  for "Immediately" or text that is not a date),
- `message(req) -> { message }` for the field (`en.submit.errors.scheduleRequired`,
  `schedulePast`, `scheduleTooFar(maxAheadDays)`),
- `timeZone() -> { timeZone }` for the hint.

`LocalRunSchedule` (`model/local-run-schedule.ts`) takes `d: { clock: Clock }` (kernel port) and
parses the `datetime-local` text as local time (`new Date('YYYY-MM-DDTHH:mm')`, which ECMAScript
reads as local), compares it with `clock.now()` (must be strictly later) and with now plus
`JOB_LIMITS.scheduledAt.maxAheadDays` days, and reads the zone name from
`Intl.DateTimeFormat().resolvedOptions().timeZone`. All three drafts take it in their deps; the
`use*JobDraft` hooks build it with `SystemClock`, as the transit draft does today. Alternative:
check against the time in the browser in each draft; rejected (written three times, untestable
without the clock port).

**3. Execution settings kept across a type switch include the schedule.**
`JobFormExecution` gains `run` and `scheduledAt`; `SubmitJobPage`'s default is
`{ run: 'now', scheduledAt: '' }` and its form subscription copies them along with priority and max
attempts. `emptyValues({ execution })` already spreads the execution into the values.

**4. The run choice is its own component.** `submit/run-choice.tsx` renders the two toggle buttons
(`role="group"`, `aria-pressed`, the existing styles) bound to `run` with `useController`, and, for
"later", a `FormField` with `<Input type="datetime-local">`, the hint
`en.submit.scheduleHint(timeZone)` or the field error. `job-form.tsx` drops the `ComingSoon` around
it; the idempotency key keeps its `ComingSoon`.

**5. Preview.** `JobRequestPreview` gains `scheduledAt?: string`; each draft's `previewRequest`
returns the values without `run` and with `scheduledAt` from `RunSchedule.toRequest` (so a half-typed
or "now" time is left out). `RequestPreview` sets the example's `status` to `scheduled` and adds
`scheduledAt` when the request has one.

**6. Job display.** In `JobPresenter`:
- `lifecycle`: when `job.scheduledAt` is after `job.createdAt`, the first step is
  `{ status: 'scheduled', reached: true, at: createdAt }` instead of `pending`; otherwise unchanged.
- The list's Status cell and the Details row use the existing `dateTime` format (local
  "30 Oct, 14:30:00").
`useJobFields` gains `scheduledFor: string | null` (null without `scheduledAt`); `JobDetailsList`
adds the "Scheduled for" row after Created only when it is set. `JobRow` shows, for status
`scheduled`, the badge and under it `presenter.dateTime({ at: job.scheduledAt })`.

**7. Tests and time.** Model tests mock the clock with `mockDeep<Clock>()` and
`mockReturnValueOnce`; page tests fake only `Date` (`vi.useFakeTimers({ toFake: ['Date'] })`,
`vi.setSystemTime`), as the transit tests already do, so user-event timers keep running. With
`TZ=UTC` local equals UTC, so one `LocalRunSchedule` test sets `process.env.TZ` to a zone with an
offset (restored after) to prove the conversion is local -> UTC.

## Risks / Trade-offs

- [`datetime-local` looks different per browser and has no seconds by default] -> minute precision
  is enough for a schedule; styled with the shared `Input` classes.
- [The check uses the browser's clock, the API uses job-service's] -> a time a few seconds ahead may
  pass the form and still be created `pending` by the API (it then runs at once and its Lifecycle
  shows pending). Accepted; the API stays the authority.
- [A user who leaves the page open may submit a time that has passed since they typed it] -> the
  check runs on submit, not only on input.
- [Changing `process.env.TZ` at runtime in one test] -> restored in `afterEach`; Node re-reads TZ
  when it is assigned.

## Migration Plan

UI only; deployed with job-ui. Rollback is reverting the change.
