# Decisions: job-group-create-ui

## Decided

- Creating a group in job-ui creates the group together with its jobs in one flow: create an empty
  group, bulk-submit its jobs with the group's id, delete the still-empty group if the submit fails,
  then open the group page (user)
- The page is opened from a "New group" button in the app frame's header (user)
- The page shows no request preview (cURL / example response) (user)
- Each job of the group is a tab; the open tab shows that job's form. A "+" tab adds one more job
  (user)
- Each tab's content has a "Duplicate" button that inserts an identical copy right after that job
  (user)
- After "Duplicate" the new copy is the open tab (user; asked during apply)
- A tab reads "Job N · <type>" and has a small × that removes the job, hidden while only one tab is
  left; numbers follow the tab order (user)
- job-ui gets a config value for the most jobs in a group, default 100 (job-service's default bulk
  maximum); at the limit "+" and Duplicate are disabled with a hint naming the limit (user)
- On "Create group", every tab with an invalid field is highlighted red, the first invalid tab
  opens with its field errors shown, and nothing is sent (user)
- When the bulk submit fails with `VALIDATION_FAILED`, each issue for `jobs.<n>.<field>` is shown
  under that field in job n's tab and that tab is highlighted red; issues not tied to a job's field
  go to an alert above the buttons (user)
- When creating the group or the bulk submit fails, an alert above the buttons shows the API's
  message (or that the API is unreachable); every tab and value stays so the user can try again
  (user)
- When the bulk submit fails and deleting the empty group fails too, only the submit error is
  shown; the empty group stays behind as a running group with no jobs (noted in `DECISIONS.md`),
  and trying again creates a new group (user)
- A tab with errors (form validation or API issues) is highlighted red (user)
- The page follows the submit page's layout and components, with the tab strip above the form and
  no preview column; no separate design (user)
- Tests: job-ui Playwright with a mocked API for every state, plus one system e2e scenario that
  creates a group with two jobs on the running stack and sees its page (user)
- The page is at `/groups/new`; opening it directly works and Back returns to the previous page (user confirmed assumption)
- The header's "New group" button sits next to "New job", as a secondary (outline) button so "New job" stays the primary action (user confirmed assumption)
- The breadcrumb reads "Groups / New group"; Cancel opens the groups list and creates nothing (user confirmed assumption)
- The page opens with one tab, "Job 1 · Email", holding the submit page's initial values; "+" adds an Email job with initial values and opens it (user confirmed assumption)
- A tab's form is the submit page's "1. Job type", "2. Payload" and "3. Execution" sections with every type, the same initial values, validation rules and messages; switching type in a tab keeps Priority and Max attempts as on the submit page; the type is not put in the URL (user confirmed assumption)
- Removing the open tab opens the tab before it (or the new first tab) (user confirmed assumption)
- Editing a field in a red tab clears that field's error, and the tab's red highlight goes away when it has no errors left (user confirmed assumption)
- The submit button reads "Create group (N jobs)"; while creating it shows a busy state and cannot be clicked again (user confirmed assumption)
- Leaving the page with unsent jobs asks for nothing; the jobs are lost (user confirmed assumption)
- The groups list's empty state hint mentions "New group" (user confirmed assumption)

## Assumed

- [x] The page is at `/groups/new`; opening it directly works and Back returns to the previous page - matches `/jobs/new`
- [x] The header's "New group" button sits next to "New job", as a secondary (outline) button so "New job" stays the primary action - one primary action per header
- [x] The breadcrumb reads "Groups / New group"; Cancel opens the groups list and creates nothing - mirrors the submit page
- [x] The page opens with one tab, "Job 1 · Email", holding the submit page's initial values; "+" adds an Email job with initial values and opens it - same start as the submit page
- [x] A tab's form is the submit page's "1. Job type", "2. Payload" and "3. Execution" sections with every type, the same initial values, validation rules and messages; switching type in a tab keeps Priority and Max attempts as on the submit page; the type is not put in the URL - same forms the user knows; one URL for the page
- [x] Removing the open tab opens the tab before it (or the new first tab) - predictable focus
- [x] Editing a field in a red tab clears that field's error, and the tab's red highlight goes away when it has no errors left - errors follow the fix
- [x] The submit button reads "Create group (N jobs)"; while creating it shows a busy state and cannot be clicked again - avoids two groups
- [x] Leaving the page with unsent jobs asks for nothing; the jobs are lost - same as the submit page today
- [x] The groups list's empty state hint mentions "New group" - the list is no longer fed only by API clients

## Open questions

- [x] Is there a design / screenshot for this page? → follow the submit page's layout
- [x] Tests? → job-ui Playwright with a mocked API plus one system e2e scenario
- [x] How are items added and edited? → as tabs, one job per tab, "+" adds one
- [x] What does "Duplicate" do? → inserts one copy right after the job
- [x] How many jobs may a group have in the UI? → job-ui config value, default 100
- [x] How are bulk `VALIDATION_FAILED` issues shown? → under the field in that job's tab, tab highlighted red
- [x] What does the user see when the group create or bulk submit fails? → alert above the buttons, tabs stay
- [x] Bulk fails and deleting the empty group fails too? → submit error only; empty group stays
- [x] How is a job removed, what does a tab show? → × on the tab, "Job N · <type>"
- [x] Client-side validation over several tabs? → invalid tabs highlighted red, first one opens
- [x] Which tab is open after "Duplicate"? → the new copy
