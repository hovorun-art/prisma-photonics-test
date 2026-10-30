# Tasks

## Plan

```
1 (API ports, config, strings, model interfaces)
├── 2 (tab list, create flow, bulk issue split)  ┐ parallel
└── 3 (split JobForm into sections + footer)     ┘
        └── 4 (new group page)  ← needs 2 and 3
                └── 5 (integration: route, header, list hint, proxy, e2e, DECISIONS.md, checks)
```

Groups 2 and 3 could run in parallel; everything else is sequential.

## 1. API ports, config, strings and model interfaces

Owns: `apps/job-ui/src/features/groups/api/groups-api.ts`, `apps/job-ui/src/features/groups/api/fetch-groups-api.ts`, `apps/job-ui/src/features/groups/api/fetch-groups-api.test.ts`, `apps/job-ui/src/features/jobs/api/jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.ts`, `apps/job-ui/src/features/jobs/api/fetch-jobs-api.test.ts`, `apps/job-ui/src/config/ui-config.ts`, `apps/job-ui/src/locales/en.ts`, `apps/job-ui/src/features/groups/model/group-job-tabs.ts`, `apps/job-ui/src/features/groups/model/group-creation.ts`, `apps/job-ui/src/features/groups/model/bulk-issues.ts` · Depends on: none · Parallel with: none

- [x] 1.1 Write failing tests in `fetch-groups-api.test.ts` for `create` (POST `/v1/groups` without a body, 201 parsed as `JobGroup`; error body → `ApiError` with its code) and `delete` (DELETE `/v1/groups/:id`, 204; 409 → `ApiError` `JOB_GROUP_NOT_EMPTY`), and in `fetch-jobs-api.test.ts` for `createBulk` (POST `/v1/jobs/bulk` with `{ jobs }`, 201 parsed with `CreateJobsBulkResponse`; 400 → `ApiError` `VALIDATION_FAILED` with its details); see them fail
- [x] 1.2 Add `create`/`delete` to `GroupsApi` and `createBulk` to `JobsApi` with their Request/Response types, implement them in `FetchGroupsApi`/`FetchJobsApi`; verify the tests from 1.1 pass
- [x] 1.3 Add `maxGroupJobs` (100, kept at or below job-service's `JOB_SERVICE_BULK_MAX_JOBS`) to `UiConfig`, the new group page strings to `locales/en.ts` (header "New group", breadcrumb, title, tab label `Job N · <type>`, "Duplicate", remove label, "Create group (N jobs)", busy text, maximum hint) and the groups list empty hint mentioning "New group"; verify `npm run typecheck -w apps/job-ui`
- [x] 1.4 Declare the interfaces `GroupJobTabs`, `GroupCreation` (with `GroupCreationDeps`) and `BulkIssues` with their Request/Response types as in design.md decisions 3–5; verify `npm run typecheck -w apps/job-ui`
- [x] 1.5 Run the `test-case-reviewer` subagent on `apps/job-ui` unit tests `features/groups/api/fetch-groups-api.test.ts` and `features/jobs/api/fetch-jobs-api.test.ts`; add the missing cases it reports or note why they belong elsewhere

## 2. Tab list, create flow and bulk issue split

Owns: `apps/job-ui/src/features/groups/model/group-job-tabs.impl.ts`, `apps/job-ui/src/features/groups/model/group-job-tabs.impl.test.ts`, `apps/job-ui/src/features/groups/model/group-creation.impl.ts`, `apps/job-ui/src/features/groups/model/group-creation.impl.test.ts`, `apps/job-ui/src/features/groups/model/bulk-issue-splitter.ts`, `apps/job-ui/src/features/groups/model/bulk-issue-splitter.test.ts` · Depends on: 1 · Parallel with: 3

- [x] 2.1 Write failing `GroupJobTabsImpl` tests named after the scenarios "New group page at first" (one Email tab, open), "Add a job", "Duplicate a job" (copy right after, later tabs shift), "Remove a job", "Remove the first job", "Last job cannot be removed", "At the maximum" and "Below the maximum again"; see them fail
- [x] 2.2 Implement `GroupJobTabsImpl`; verify the tests from 2.1 pass
- [x] 2.3 Write failing `GroupCreationImpl` tests (mocked `GroupsApi`/`JobsApi`, `...Once` stubs) for "Create a group with two jobs" (bulk gets every job with the group's id in order), "Group cannot be created" (no bulk call), "Group deleted after a failed submit" (delete called once, bulk error rethrown), "Delete fails after a failed submit" (bulk error rethrown, not the delete error) and "Try again after a failed submit" (a second create uses the new group's id); see them fail
- [x] 2.4 Implement `GroupCreationImpl`; verify the tests from 2.3 pass
- [x] 2.5 Write failing `BulkIssueSplitter` tests: issues on `jobs.<n>.<field>` go to job n with path `<field>`; issues on `jobs`, on an index without a job, or details without issues go to the leftover messages ("API validation error not tied to a job's field"); see them fail
- [x] 2.6 Implement `BulkIssueSplitter`; verify the tests from 2.5 pass
- [x] 2.7 Run the `test-case-reviewer` subagent on `apps/job-ui` unit tests in `features/groups/model/`; add the missing cases it reports or note why they belong elsewhere

## 3. Split the job form into sections and footer

Owns: `apps/job-ui/src/features/jobs/submit/job-form.tsx`, `apps/job-ui/src/features/jobs/submit/job-form-sections.tsx`, `apps/job-ui/src/features/jobs/submit/submit-job-page.tsx`, `apps/job-ui/src/features/jobs/submit/submit-job-page.test.tsx`, `apps/job-ui/src/features/jobs/submit/email-payload-fields.tsx`, `apps/job-ui/src/features/jobs/submit/webhook-payload-fields.tsx`, `apps/job-ui/src/features/jobs/submit/transit-payload-fields.tsx` (their import of `FormField`) · Depends on: 1 · Parallel with: 2

- [x] 3.1 Run `submit-job-page.test.tsx` and `apps/job-ui/test/e2e/jobs.spec.ts` green as the baseline (refactor with no behaviour change; the existing tests are the safety net)
- [x] 3.2 Move the three sections, `FormField` and the field `input`/`errorOf` logic into `JobFormSections` (reads the form from context, takes the draft, picker and payload); `JobForm` keeps the create mutation, alert and footer and renders `JobFormSections`; verify `submit-job-page.test.tsx` and job-ui's `jobs.spec.ts` Playwright still pass unchanged

## 4. New group page

Owns: `apps/job-ui/src/features/groups/hooks/use-create-group.ts`, `apps/job-ui/src/features/groups/create/group-job-tab.tsx`, `apps/job-ui/src/features/groups/create/new-group-page.tsx`, `apps/job-ui/src/features/groups/create/new-group-page.test.tsx`, `apps/job-ui/src/features/jobs/submit/field-id-prefix-context.ts`, and after group 3 is committed `apps/job-ui/src/features/jobs/submit/job-form-sections.tsx` and `transit-payload-fields.tsx` (field ids per tab: several job forms are mounted at once) · Depends on: 2, 3 · Parallel with: none

- [x] 4.1 Write failing `new-group-page.test.tsx` tests (mocked `GroupsApi`/`JobsApi` through their contexts) named after "New group page at first", "Tab label follows the type", "Switching type in a tab keeps the execution settings", "Each tab keeps its own values", "Add a job", "Duplicate a job", "Remove a job", "Last job cannot be removed", "At the maximum" (small `maxGroupJobs` through the UI config), "Below the maximum again"; see them fail
- [x] 4.2 Implement `GroupJobTab` (one form per tab, type in local state, handle with `validate`, `values`, `showApiIssues`, `onErrorsChange`) and `NewGroupPage` (breadcrumb, tab strip with "+", ×, red highlight, open tab's form with "Duplicate", alert, Cancel, "Create group (N jobs)") on `GroupJobTabsImpl`; verify the tests from 4.1 pass
- [x] 4.3 Write failing tests named after "Create a group with two jobs" (opens `/groups/<id>`), "Busy while creating", "Cancel the new group", "Invalid job in another tab", "Several invalid tabs", "Fixing a tab clears its highlight", "API validation error on a job's field", "API validation error not tied to a job's field", "Group cannot be created", "API unreachable", "Other API error on the job submit", "Group deleted after a failed submit", "Delete fails after a failed submit", "Try again after a failed submit"; see them fail
- [x] 4.4 Implement `useCreateGroup` (mutation over `GroupCreationImpl`, invalidates `['groups']` and `['jobs']`) and the create/validation/error handling in the page with `BulkIssueSplitter`; verify the tests from 4.3 pass
- [x] 4.5 Run the `test-case-reviewer` subagent on `apps/job-ui` unit test `features/groups/create/new-group-page.test.tsx`; add the missing cases it reports or note why they belong elsewhere

## 5. Integration

Owns: `apps/job-ui/src/app.tsx`, `apps/job-ui/src/app.test.tsx`, `apps/job-ui/src/features/app-frame/app-frame.tsx`, `apps/job-ui/src/features/app-frame/app-frame.test.tsx`, `apps/job-ui/src/features/groups/list/groups-list-page.test.tsx`, `apps/job-ui/vite.config.ts`, `apps/job-ui/nginx.conf`, `apps/job-ui/test/e2e/groups.spec.ts`, `tests/system-e2e/job-ui.spec.ts`, `DECISIONS.md`, `CLAUDE.md` · Depends on: 4 · Parallel with: none

- [ ] 5.1 Write failing tests for "Header on every page" (with the new group page and the "New group" button), "New group from the header" (`app-frame.test.tsx`), "Direct link to the new group page" (`app.test.tsx`) and "No groups" with the "New group" hint (`groups-list-page.test.tsx`); see them fail
- [ ] 5.2 Add the "New group" outline button before "New job" in the header and the `/groups/new` route before `/groups/:id`; verify the tests from 5.1 pass
- [ ] 5.3 Check that the Vite dev proxy and `nginx.conf` pass `POST`/`DELETE` on `/v1/groups` and `POST /v1/jobs/bulk` to their services; fix if not, and verify with `npm run dev` and a manual group creation
- [ ] 5.4 Add job-ui Playwright cases to `test/e2e/groups.spec.ts` (mocked API routes): "Create a group with two jobs", "Invalid job in another tab", "Group deleted after a failed submit"; run them in the main agent and see them pass
- [ ] 5.5 Add a system e2e case to `tests/system-e2e/job-ui.spec.ts`: create a group with an email and a webhook job through the UI on the running stack and see its page with two job cells; run it in the main agent and see it pass
- [ ] 5.6 Record in `DECISIONS.md` the UI create flow across two services (compensating delete, an empty running group left when that delete fails too) and the `maxGroupJobs` default kept equal to job-service's bulk maximum; update the job-ui line of `CLAUDE.md`'s architecture block
- [ ] 5.7 Run the `test-case-reviewer` subagent on `apps/job-ui` unit tests (`app.test.tsx`, `app-frame.test.tsx`, `groups-list-page.test.tsx`), `apps/job-ui/test/e2e/groups.spec.ts` and `tests/system-e2e/job-ui.spec.ts`; add the missing cases it reports or note why they belong elsewhere
- [ ] 5.8 Run the full checks (CHECK_CMDS: `npm run typecheck`, `npm run lint`, `npm test`; plus `npm run test:e2e` in the main agent) and see them green

## Workflow follow-up

- Run the `change-verifier` subagent and get PASS.
- `/archive job-group-create-ui` on the change branch, then merge into `master` with the user's approval.
