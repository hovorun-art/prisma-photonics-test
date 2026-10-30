# Design

## Context

job-ui is a React 19 + Vite app with Tailwind 4, TanStack Query and shadcn's config (`components.json`,
neutral tokens in `src/index.css`), but no components yet: it only renders the "started" page
(`features/app-shell`). The browser reaches job-service at `/api/*` (Vite proxy in dev, nginx in
compose), with the prefix stripped, so the job routes are `/api/v1/jobs` and Swagger is `/api/docs`.
The API and its Zod schemas are fixed by `job-api` (`packages/contracts/src/jobs/job.ts`,
`errors.ts`): `GET /v1/jobs` returns `{ items, total }` newest first with job-service's configured
default page size (20) when no `limit` is sent.

Lint rules that shape the frontend: free functions are allowed only in `*.tsx`; every class
implements an interface; `react-refresh/only-export-components` warns (and `--max-warnings 0` fails)
when a `.tsx` file exports a non-component.

The visual source is the user's Claude Design project (see `decisions.md`): screens Main,
JobDetail, SubmitJob and Components.

## Goals / Non-Goals

**Goals:**
- One `features/jobs` folder with list, details and submit pages over a single API client typed by
  the shared contracts; the app frame in its own feature.
- Tests at each level the project defines, deterministic (no real timers or network in unit tests).

**Non-Goals:**
- No new API, no change to `packages/contracts`.
- No dark theme, no "updated Ns ago" counter in the live indicator (it reads "Live"), no
  "scheduled" step in the Lifecycle (no scheduled jobs exist yet; `job-scheduling` adds it).

## Decisions

### Routing: `react-router` (v7, data-less "declarative" mode)
`/` redirects to `/jobs`; `/jobs`, `/jobs/new`, `/jobs/:id` render inside an `AppFrame` layout route
(header + `<Outlet/>`). Unknown paths redirect to `/jobs`. nginx already falls back to `index.html`,
and `vite preview` does the same. Alternative: TanStack Router — typed routes, but one more concept
for three routes.

### Structure
```
src/
  app.tsx                         routes; main.tsx adds QueryClient and the providers
  config/                         api-base-path.ts, ui-config.ts (UI_CONFIG defaults)
  lib/class-names.ts              shadcn's cn()
  components/ui/                  shadcn: button, badge, card, dialog, tooltip, input, textarea,
                                  label, skeleton, alert
  features/app-frame/             app-frame.tsx (header, nav, "New job", API status pill),
                                  coming-soon.tsx (disabled wrapper + tooltip)
  features/jobs/
    api/      jobs-api.ts (JobsApi interface, Request/Response types), fetch-jobs-api.ts,
              api-error.ts (ApiError), jobs-api-context.tsx (provider), use-jobs-api.ts
    model/    job-presenter.ts (short id, details text, times, total time, lifecycle steps),
              curl-builder.ts (cURL for submit and get), status-style.ts (badge colours)
    hooks/    use-jobs-page.ts, use-job.ts, use-create-job.ts, use-delete-job.ts, use-copy.ts,
              use-ui-config.ts
    list/     jobs-list-page.tsx, jobs-table.tsx, jobs-pager.tsx, queue-stats.tsx,
              jobs-toolbar.tsx (disabled filters and search), live-indicator.tsx
    details/  job-page.tsx, job-header.tsx, json-card.tsx, lifecycle.tsx, job-details-list.tsx,
              delete-job-dialog.tsx, job-not-found.tsx
    submit/   submit-job-page.tsx, email-job-form.tsx, job-type-picker.tsx, request-preview.tsx
  locales/en.ts                   every string, grouped by feature
```
`features/index.ts` exports the pages and the frame for `app.tsx`. The old `features/app-shell`
and its tests are removed.

### API client: `FetchJobsApi implements JobsApi`
Methods `query({ offset })`, `get({ id })`, `create({ request })`, `delete({ id })` each take one
request object and return one response object, following the project's class rules. Responses are
parsed with the contract schemas (`QueryJobsResponse`, `Job`), so a contract drift fails loudly at
the edge. A non-2xx answer whose body parses as `ErrorBody` throws `ApiError` (extends `Error`,
implements `ApiErrorShape`: `status`, `code`, `message`, `details`); any other failure (network,
unparsable body) throws `ApiError` with `code: null` and a generic locale message. The client takes
`p: { baseUrl }`, which is `new URL(API_BASE_PATH, window.location.origin)` in the app and an
absolute test origin in unit tests (Node's fetch needs absolute URLs). It reaches components through
`JobsApiProvider` (React context), so tests pass a client pointed at MSW.

### Server state: TanStack Query
- List: `['jobs', { offset }]`, `refetchInterval: pollIntervalMs`, `placeholderData: keepPreviousData`
  so paging and failed polls keep the last rows. "Connection lost, retrying" shows when
  `isRefetchError` (data present, last fetch failed); it clears on the next success.
- Job: `['job', id]`, same interval; `enabled` only when `JobIdParams` accepts the id (a malformed
  id never reaches the API and renders "Job not found"). A `JOB_NOT_FOUND` `ApiError` renders "Job
  not found", including on a later poll. No retry for 4xx answers (`retry` returns false for
  `ApiError` with a code), so not-found shows at once.
- Create: on success invalidate `['jobs']` and navigate to `/jobs/<id>`.
- Delete: on success or `JOB_NOT_FOUND`, remove `['job', id]`, invalidate `['jobs']` and navigate
  to `/jobs`; any other error stays in the dialog.

### Configuration
`UI_CONFIG` in `config/ui-config.ts`: `pollIntervalMs: 2000`, `copiedFeedbackMs: 1500`,
`shortIdLength: 8`. Provided through `UiConfigProvider` so tests can shorten intervals instead of
waiting. Page size is not configured in the UI: it sends no `limit`. Next steps `offset` by the
number of items in the current (full) page and pushes the old offset on a stack; Previous pops it,
so it always returns to the page the user came from, even from a shorter last page. "First page" is
`offset === 0`, "last page" is `offset + items.length >= total`.

### Submit form
`react-hook-form` (`useForm` in `SubmitJobPage`, shared with the form through `FormProvider`) with
`zodResolver(CreateEmailJobRequest)`, the same schema job-service uses. The form values are the
request itself (`EmailFormValues = z.input<typeof CreateEmailJobRequest>`), so field names are
request paths (`payload.to`, `priority`) and API issue paths map onto them directly; Priority and
Max attempts are registered with `valueAsNumber` and start at `JOB_LIMITS.*.default`.
`ZodEmailJobDraft implements EmailJobDraft` (`features/jobs/model/`; named "draft" so it does not
clash with the `EmailJobForm` component) keeps what the library does not: `fieldMessage` gives
job-ui's own locale message for a field the schema rejected, and `apiErrors` reads an API
`VALIDATION_FAILED` through the contract schema `ValidationFailedDetails` (`{ path, message }[]`)
and returns the per-field messages, which the form sets with `setError` (type `api`, shown as the
API wrote them), plus the issues that match no field, which go to a root error shown in the
`Alert` above the buttons together with every other API error. The request preview renders the same object the form will
send (`JSON.stringify`, two-space indent) and `CurlBuilder` turns it into
`curl -X POST <origin>/api/v1/jobs -H 'Content-Type: application/json' -d '<json>'`. The example
response is built from the form values with placeholder `id`/timestamps and is labelled "Example".

### Errors: `react-error-boundary` + `QueryErrorResetBoundary`
`AppFrame` wraps its page outlet in `PageErrorBoundary` (`features/app-frame/`), so every page has
its own boundary and the header stays:
TanStack Query's `QueryErrorResetBoundary` around `react-error-boundary`'s `ErrorBoundary`, keyed
by the location (`resetKeys`) so navigating away clears it. Its fallback, `PageError`, shows
"Something went wrong" and a Reload button whose `resetErrorBoundary` also resets the failed
queries, so they load again. The list and job queries set `throwOnError` for a failed first load
only (`query.state.data === undefined`) and never for `JOB_NOT_FOUND`, which keeps its own "Job not
found"; a failed poll with data on screen keeps the "Connection lost, retrying" note.

### Formatting: `JobPresenter implements JobPresentation`
Short id (first `shortIdLength` characters), Details text per status, list time `HH:mm:ss`, page
date-time `29 Oct, 21:02:09` (`Intl.DateTimeFormat('en-GB', …)` in the browser's time zone), total
time (`1.2s` below a minute, `3m 4s` above), and lifecycle steps (`pending` reached always;
`processing` reached once `startedAt` is set; final step = the job's status when it is
`completed`/`failed`/`cancelled`, otherwise a not-reached `completed`). Unit tests set `TZ=UTC` in
the job-ui Vitest setup file so times are deterministic.

### Copy feedback: `useCopy`
Writes through `navigator.clipboard.writeText` and flips a `copied` flag for `copiedFeedbackMs`.
Tests use `userEvent.setup()`, which installs a clipboard stub, and fake timers for the reset.

### Disabled "Coming soon" elements
`ComingSoon` wraps a disabled control in a shadcn `Tooltip` whose trigger is a focusable `span`
(`tabIndex=0`) so hover and keyboard focus both show "Coming soon"; the control itself has
`disabled` and `aria-disabled`, muted styles. Statistics cards render "—"; the header pill reads
"API status —". Cancel/Retry show in the Actions column where the design shows them (Cancel for
`pending`/`scheduled`, Retry for `failed`), disabled; other rows show "—". Which actions a status
offers (cancel, retry, delete) is decided once, in `JobPresenter.actions`, from the contract's
`FINISHED_JOB_STATUSES`; the list row and the job header both read it. Status colours live once in
`model/status-style.ts`; the statistics cards take their dot colour from it.

### Look and feel
Tailwind theme tokens in `index.css` replace the neutral shadcn defaults with the design's values:
ground `#F7F7F5`, surface `#FFFFFF`, border `#E6E6E3`, input border `#D4D4D0`, ink `#17171A`,
secondary `#5C5C63`, accent `#1F3FC4`, danger `#B42121`, radius 12px for cards and 8px for
controls, `--font-sans: Inter`, `--font-mono: JetBrains Mono` (from `@fontsource/inter` 400/500/600
and `@fontsource/jetbrains-mono` 400/500). Status badge pairs (fg/bg): scheduled `#5B3FB8/#F1EDFC`,
pending `#8A4B00/#FDF3E2`, processing `#1F3FC4/#EBEFFD`, completed `#13703A/#E8F5EC`, failed
`#B42121/#FCEBEB`, cancelled `#5C5C63/#F0F0EE`. Content width `max-w-[1280px]`; the table has a min
width and scrolls horizontally inside its card.

### Lint exemption for hooks and `cn`
CLAUDE.md exempts React hooks from the no-free-functions rule, but the ESLint config only exempts
`*.tsx`, and a hook exported from `.tsx` trips `react-refresh`. `FREE_FUNCTIONS_ALLOWED` gains
`apps/job-ui/src/**/use-*.ts` and `apps/job-ui/src/lib/class-names.ts` (shadcn's `cn`). Everything
else in `.ts` stays in classes.

### New dependencies (job-ui)
`react-router`, `react-error-boundary`, `react-hook-form`, `@hookform/resolvers`, `@fontsource/inter`, `@fontsource/jetbrains-mono`, `zod` (direct, for
`safeParse` on contract schemas), and the shadcn stack: `radix-ui`, `class-variance-authority`,
`clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`. Components are generated into
`components/ui` by the shadcn CLI (`npx shadcn add …`) and kept as generated; the design is applied
through shadcn's standard tokens in `index.css` (`--accent` is shadcn's hover colour, the design's
blue is `--link`) and through `className` at the call site. `components/ui` is exempt from
`react-refresh/only-export-components`, since shadcn exports variant helpers next to components.

### Tests
- Unit/component (`*.test.ts(x)` next to the code, Vitest + jsdom + Testing Library): presenter
  and cURL builder with plain inputs; `FetchJobsApi` and every page against MSW (`msw/node`), one
  test per spec scenario, named after it. Clipboard via `userEvent`; polling with a short
  `pollIntervalMs` from `UiConfigProvider` and `waitFor`.
- job-ui Playwright (`test/e2e/*.spec.ts`, built app via `vite preview`, API mocked with
  `page.route`): routing, Back, list → job, submit → job page, delete flow. Replaces
  `app-shell.spec.ts`.
- System e2e (`tests/system-e2e/job-ui.spec.ts`): the started-page test is replaced by submit an
  email job → see it in the list → open its page; the nginx API proxy test stays. The "completed"
  step comes with whichever of this change and `email-job-execution` merges second.

## Risks / Trade-offs

- [Polling every 2 s from every open tab loads job-service] → one list query and at most one job
  query per tab; SSE is a later option noted in CLAUDE.md.
- [Paging by offset while new jobs arrive shifts rows between pages] → accepted: the API is
  offset-based; the footer shows the live total.
- [Example response could be mistaken for a real one] → labelled "Example" and uses a placeholder id.
- [`TZ=UTC` in tests hides time-zone bugs] → the presenter only uses `Intl` with the browser's zone;
  one test checks the format shape rather than a zone.

## Migration Plan

Front-end only. Deploy by rebuilding the `job-ui` image; rollback by redeploying the previous image.
The `system-health` requirement "job-ui shows that it has started" is removed with its tests.
