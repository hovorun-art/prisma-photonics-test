# Decisions: job-group-ui

## Decided

- job-ui gets two pages for job groups: a groups list and a details page for each group (user)
- The groups list page is similar to the jobs list page (user)
- The group details page follows the user's existing design (user)
- The change is built on its own branch `job-group-ui`, created from master, not from
  `job-group-service`; the group API is wired in once `job-group-service` is published (user)
- The groups list shows the columns Group ID (short), Status (badge: running, completed, failed),
  Progress (completed/failed/total with a bar), Created and Finished (user)
- The groups list has paging only, no status filters: `GET /v1/groups` supports only
  `limit`/`offset`; filters can come in a later change (user)
- The group details page follows the design "Job Queue — UI", `project/BatchJob.dc.html`, adapted
  to a group (user; inventory and mapping in `ui.md`); same layout and feel with the project's
  tokens and components, not pixel-exact (user)
- The group details page shows no child jobs table (user; replaces the earlier answer "reuse the
  jobs table")
- The progress card has no Rate, Elapsed or ETA line; only stored values are shown (user)
- The progress card keeps the design's cell grid with one cell per real child job, for all of the
  group's child jobs however many pages of `GET /v1/jobs?groupId=` that takes (user)
- A cell shows the job's short id and status on hover and focus, and opens the job's page on click
  (user)
- Cells use the design's three colours: completed blue, failed or cancelled red, every other status
  grey (user)
- Created and Finished are shown as on the job pages: local time of day in the groups list, date
  and time in the group's Details card (user)
- The groups list's Finished column shows "—" while a group is running (user)
- Both pages are read only: no create or delete of groups in the UI; groups are created by API
  clients together with their jobs (user)
- No system e2e scenario for groups in this change; the pages are covered by job-ui's Playwright
  e2e with a mocked API (user)

## Assumed

- [x] The groups list is at `/groups` and a group's page at `/groups/:id`; Back and direct links work as for jobs - matches the existing jobs URLs
- [x] The app frame's navigation gets a "Groups" item next to "Jobs" - the list must be reachable
- [x] Both pages poll at the configured polling interval with the live indicator, and a failed poll keeps the last data, as on the jobs pages - same behaviour users already know
- [x] The groups list shows loading skeletons, an empty state "No groups yet", and "Something went wrong" with Reload on a failed first load, as the jobs list does - same states as the jobs list
- [x] An unknown group id, or one that is not a UUID, shows "Group not found" with a link back to Groups, and a non-UUID is not sent to the API - mirrors "Job not found"
- [x] Group page header: breadcrumb "Groups / <id>", the full id, the group status badge and the live indicator; the design's type badge, Cancel button, Result, Worker lease and Payload cards are left out - groups have no type, payload or worker, and the pages are read only
- [x] Progress card: the percentage and "X of Y jobs" count finished jobs (completed + failed) out of total, rounded down, 0% when the group has no jobs yet; the tiles are Completed, Failed and Remaining (total − completed − failed); the grid header reads "Jobs 1–N" without the design's checkpoint text - the group's stored counts, nothing estimated
- [x] Cells are ordered oldest job first (job 1 is the first submitted), in the design's 25 columns; a group with no jobs yet shows "No jobs in this group yet" in place of the grid - matches the design's "Items 1–N" reading order
- [x] The cells come from the child jobs themselves, so they can briefly differ from the counts above them, which are as of the group's last check; both refresh at the polling interval - avoids a second source for the counts
- [x] Details card: Created, Updated, Last checked and Finished, with "—" for a value not set yet - the stored fields of a group
- [x] Loading the group page shows skeletons, and a failed first load shows "Something went wrong" with Reload, as on the job page - same states as the job page

## Open questions

- [x] How are Created and Finished shown in the groups list and the group's Details card? → as on the job pages: the list shows the local time of day (like the jobs list's Created), the Details card the date and time (like the job page's Details)
- [x] What does the groups list's Finished column show while a group is still running? → "—", as the job page shows a time not reached yet
