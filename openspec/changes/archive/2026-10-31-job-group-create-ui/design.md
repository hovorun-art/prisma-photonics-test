# Design

## Context

See proposal.md for the motivation and `specs/job-ui/spec.md` for the behaviour. What exists:

- The submit page (`features/jobs/submit/`) builds one job with react-hook-form: `SubmitJobPage`
  keeps the type in the URL and Priority/Max attempts in state, `TypedSubmit` owns one `useForm` per
  type with the type's `JobFormDraft` (initial values, Zod schema, field messages, API issue
  mapping), and `JobForm` renders the three sections and the footer and runs the create mutation.
- `GroupsApi` has `query` and `get`; `JobsApi` has `create` but no bulk call. The contracts already
  have `POST /v1/groups`, `DELETE /v1/groups/:id`, `POST /v1/jobs/bulk` (`CreateJobsBulkRequest`,
  `CreateJobsBulkResponse`) and the optional `groupId` on `CreateJobRequest`.
- A bulk `VALIDATION_FAILED` answer names issues by request path, e.g. `jobs.1.payload.url`.

## Goals / Non-Goals

**Goals:**
- Reuse the submit page's sections, drafts, validation and messages unchanged for each tab.
- Keep the create flow (group, bulk, compensating delete) out of React, in a class tested with
  mocked API ports.

**Non-Goals:**
- No backend or contract change; no group delete in the UI outside the compensating delete.
- No request preview, no draft persistence across reloads.

## Decisions

**1. Split `JobForm` into sections and footer.** `JobForm` today couples the sections with the
create mutation and the Cancel/Submit footer. It is split into `JobFormSections` (type picker,
payload, execution; field `input`/`errorOf` from the form context) and the submit page's own footer,
so the new group page renders the same sections inside each tab with its own footer. The submit
page's behaviour and tests stay as they are. *Alternative:* copy the sections into the groups
feature; rejected, the forms would drift.

**2. One mounted form per tab.** Each tab is a `GroupJobTab` component that owns its `useForm`
(like `TypedSubmit`: type kept in local state, not the URL; a type switch remounts the typed form
with the kept execution values). Inactive tabs stay mounted but hidden, so values and field errors
survive switching tabs. Each tab exposes a handle to the page through a ref:
`validate(): Promise<CreateJobRequest | null>` (runs the form's `trigger`/`handleSubmit`),
`values()` (type + current values, for Duplicate), `showApiIssues(details)` (maps through the
draft's `apiErrors`, sets `api` errors and the root alert) and `hasErrors`. The tab label's red
highlight reads the form's `formState.errors`, reported to the page with an `onErrorsChange`
callback. *Alternative:* one form with a `jobs` field array; rejected, the drafts and their schemas
are per type and per single job, and a field array would need every draft rewritten for paths
`jobs.n.*`. Up to the configured maximum (100) of small forms mounted is cheap.

**3. Tab list as a model class.** `GroupJobTabs` (interface in `features/groups/model/`,
`GroupJobTabsImpl`) holds the ordered tabs (`{ key, initial: { type, values } }`), the open index
and the maximum: `add()`, `duplicate({ index, initial })`, `remove({ index })`, `open({ index })`,
`canAdd()`. Immutable: each call returns the next state, so React holds it in `useState`. Keys come
from a counter inside the model (not ids sent anywhere). Unit tested for the numbering, the open
tab after remove, duplicate position and the maximum.

**4. Create flow as a model class.** `GroupCreation` (interface; `GroupCreationImpl` with
`d: { groups: GroupsApi; jobs: JobsApi }`): `create({ jobs: CreateJobRequest[] })` →
`{ group }`. Steps: `groups.create()`; `jobs.createBulk({ jobs: jobs.map(j => ({ ...j, groupId })) })`;
on a bulk error call `groups.delete({ id })`, ignore a delete error, and rethrow the bulk error.
A failure of `groups.create()` is rethrown with no other call. `useCreateGroup` wraps it in a
TanStack mutation (`isPending` drives the busy button; a second click is ignored while pending) and
invalidates `['groups']` and `['jobs']` on success. Unit tested with `mockDeep<GroupsApi>()` and
`mockDeep<JobsApi>()`.

**5. Bulk issues split per job.** `BulkIssueSplitter` (interface `BulkIssues`, model folder) turns
the `details` of a bulk `VALIDATION_FAILED` into per-job `details` (path `jobs.<n>.<rest>` →
job n, path `<rest>`) and the messages of every other issue (e.g. on `jobs` itself or an index
outside the tabs). Each tab then reuses its draft's `apiErrors`; its `unmatched` messages and the
splitter's leftovers go to the page alert. Every other error (group create failure, other codes,
network) goes to the page alert with its message, as `ApiError` already carries it (an unreachable
API already has job-ui's "unreachable" message).

**6. API additions.** `GroupsApi.create()` → `{ group }` (`POST /v1/groups`, no body, parsed with
`JobGroup`) and `GroupsApi.delete({ id })` (`DELETE /v1/groups/:id`, 204);
`JobsApi.createBulk({ jobs })` → `{ jobs }` (`POST /v1/jobs/bulk`, parsed with
`CreateJobsBulkResponse`). Implemented in `FetchGroupsApi` / `FetchJobsApi` with their existing
fetch client.

**7. Config and routing.** `UiConfig.maxGroupJobs` (default 100, job-service's
`JOB_SERVICE_BULK_MAX_JOBS` default; documented as "keep at or below job-service's bulk maximum").
Route `/groups/new` is declared before `/groups/:id`. The header gets an outline "New group" button
before "New job". Strings go to `locales/en.ts`.

**8. Tests.** Unit: `GroupJobTabsImpl`, `GroupCreationImpl`, `BulkIssueSplitter`, the fetch APIs,
`app-frame`, `groups-list-page` (hint), and `new-group-page.test.tsx` (React Testing Library with a
mocked `GroupsApi`/`JobsApi` through their contexts) for the page scenarios. job-ui Playwright
(`test/e2e/groups.spec.ts`, mocked API routes) for create success, client validation across tabs and
the compensating delete. System e2e (`tests/system-e2e/job-ui.spec.ts`): create a group with an
email and a webhook job through the UI on the running stack and see its page with two jobs.

**9. Record in `DECISIONS.md`.** The UI's create flow is not atomic across the two services: a
failed bulk is compensated by deleting the empty group, and if that delete fails too an empty
running group stays behind (no retry or cleanup job).

## Risks / Trade-offs

- [The UI's maximum can disagree with job-service's configured bulk maximum] → default kept equal;
  if job-service is configured lower, its `VALIDATION_FAILED` on `jobs` reaches the page alert.
- [An empty group can be left running when both the bulk and the delete fail] → accepted by the
  user; recorded in `DECISIONS.md`.
- [Many mounted forms] → bounded by the configured maximum; each form only re-renders on its own
  changes.
- [job-ui's proxy may route only `GET` for `/v1/groups`] → check the Vite dev proxy and nginx config
  in the integration group; the system e2e scenario would fail otherwise.
