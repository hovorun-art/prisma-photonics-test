# Spec Delta

## MODIFIED Requirements

### Requirement: Every page has the app frame
Every page of job-ui SHALL show a header with the product mark "Queue", navigation with "Jobs",
"Groups" and "API docs", and a primary "New job" button. "Jobs" SHALL open the jobs list, "Groups"
the groups list, "New job" the submit page, and "API docs" SHALL open job-service's API
documentation in a new tab.

#### Scenario: Header on every page
- **WHEN** a user opens the jobs list, a job page, the submit page, the groups list or a group page
- **THEN** the page shows the product mark "Queue", the "Jobs", "Groups" and "API docs" links and the "New job" button

#### Scenario: New job from the header
- **WHEN** a user clicks "New job" in the header
- **THEN** the submit page opens at `/jobs/new`

#### Scenario: Groups from the header
- **WHEN** a user clicks "Groups" in the header
- **THEN** the groups list opens at `/groups`

#### Scenario: API docs in a new tab
- **WHEN** a user looks at the "API docs" link
- **THEN** it points to job-service's API documentation and opens in a new tab

### Requirement: Pages have their own URLs
job-ui SHALL show the jobs list at `/jobs`, the submit page at `/jobs/new`, a job's page at
`/jobs/:id`, the groups list at `/groups` and a group's page at `/groups/:id`. The start page `/`
SHALL show the jobs list. Opening any of these URLs directly SHALL show that page, and the
browser's Back button SHALL return to the previous page.

#### Scenario: Start page is the jobs list
- **WHEN** a user opens job-ui at `/`
- **THEN** the jobs list is shown

#### Scenario: Direct link to a job
- **WHEN** a user opens `/jobs/<id>` of an existing job directly
- **THEN** that job's page is shown

#### Scenario: Back returns to the list
- **WHEN** a user opens a job from the list and then presses the browser's Back button
- **THEN** the jobs list is shown again

#### Scenario: Direct link to a group
- **WHEN** a user opens `/groups/<id>` of an existing group directly
- **THEN** that group's page is shown

#### Scenario: Back returns to the groups list
- **WHEN** a user opens a group from the groups list and then presses the browser's Back button
- **THEN** the groups list is shown again

## ADDED Requirements

### Requirement: The groups list shows groups newest first
The groups list SHALL show one page of groups from the API, newest first, as a table with the
columns Group ID, Status, Progress, Created and Finished. Group ID SHALL show a short form of the
id and link to the group's page; Status SHALL be a coloured badge (running, completed, failed);
Progress SHALL read "completed/failed/total" with a progress bar; Created and Finished SHALL be the
local time of day, and Finished SHALL read "—" while the group is running.

#### Scenario: Groups in the table
- **WHEN** a user opens the groups list while groups exist
- **THEN** each group of the first page is a row with its short id, status badge, progress as "completed/failed/total" with a bar, and creation time, in the order the API returns them

#### Scenario: Finished group in the table
- **WHEN** the groups list shows a completed or failed group
- **THEN** its Finished column shows the local time of day it finished

#### Scenario: Running group in the table
- **WHEN** the groups list shows a running group
- **THEN** its Finished column shows "—"

#### Scenario: Open a group from the list
- **WHEN** a user clicks a group's short id in the groups list
- **THEN** the group's page opens

### Requirement: The groups list pages through all groups
The groups list SHALL show one page of the API's default page size at a time, with Previous and
Next buttons and "Showing <from>–<to> of <total>". Previous SHALL be disabled on the first page and
Next on the last page. The groups list SHALL have no status or type filters.

#### Scenario: First page of groups
- **WHEN** a user opens the groups list while more groups exist than fit on one page
- **THEN** the footer shows the range of the first page and the total, Previous is disabled and Next is enabled

#### Scenario: Next page of groups
- **WHEN** a user clicks Next on the first page of the groups list
- **THEN** the list shows the next page of groups and Previous becomes enabled

#### Scenario: Last page of groups
- **WHEN** a user is on the page that holds the oldest group
- **THEN** Next is disabled

### Requirement: The groups list shows loading and empty states
While the first page loads the groups list SHALL show skeleton rows. When no group exists it SHALL
show "No groups yet".

#### Scenario: Loading groups
- **WHEN** the groups list is waiting for its first answer from the API
- **THEN** skeleton rows are shown in the table

#### Scenario: No groups
- **WHEN** a user opens the groups list while no group exists
- **THEN** the list shows "No groups yet"

### Requirement: The group page shows a group
A group's page SHALL follow the layout of the design "Job Queue — UI" (`BatchJob`, adapted to a
group as described in `ui.md`): a breadcrumb "Groups / <id>" linking back to the groups list, the
group's full id with its status badge and the live indicator, a progress card, and a Details card
with Created, Updated, Last checked and Finished as date and time, "—" for a value not set yet. The
page SHALL offer no action that changes the group.

#### Scenario: Group page header
- **WHEN** a user opens the page of a running group
- **THEN** the page shows the breadcrumb "Groups / <id>", the full id, the badge "running" and the live indicator, and no button that changes the group

#### Scenario: Back to the groups list from the breadcrumb
- **WHEN** a user clicks "Groups" in the group page's breadcrumb
- **THEN** the groups list opens

#### Scenario: Group details
- **WHEN** a user opens the page of a finished group
- **THEN** the Details card shows its creation, update, last check and finish as date and time

#### Scenario: Group not checked or finished yet
- **WHEN** a user opens the page of a running group that has not been checked yet
- **THEN** the Details card shows "—" for Last checked and Finished

### Requirement: The group page shows the group's progress
The progress card SHALL show the share of finished jobs (completed plus failed) out of the total as
a whole percentage rounded down, "<finished> of <total> jobs", a progress bar, and the counts
Completed, Failed and Remaining (total minus completed minus failed). A group with no jobs yet
SHALL show 0%. The card SHALL show no rate, elapsed time or estimate.

#### Scenario: Progress of a running group
- **WHEN** a user opens the page of a group with 3 jobs of which 1 completed and 1 failed
- **THEN** the progress card shows 66%, "2 of 3 jobs", and Completed 1, Failed 1, Remaining 1

#### Scenario: Group without jobs
- **WHEN** a user opens the page of a group that has no jobs yet
- **THEN** the progress card shows 0%, "0 of 0 jobs", and Completed 0, Failed 0, Remaining 0

#### Scenario: No timing estimates
- **WHEN** a user opens the page of a running group
- **THEN** the progress card shows no rate, elapsed time or estimated time left

### Requirement: The group page shows one cell per job
Below the progress counts the page SHALL show "Jobs 1–<n>" and a grid with one cell for each of the
group's jobs, however many there are, oldest job first. A cell SHALL be coloured as completed, as
failed (failed or cancelled) or as remaining (every other status). A group with no jobs yet SHALL
show "No jobs in this group yet" instead of the grid. The page SHALL NOT show a table of the
group's jobs.

#### Scenario: One cell per job
- **WHEN** a user opens the page of a group with more jobs than fit in one page of the jobs API
- **THEN** the grid shows one cell for every job of the group, the first cell being the oldest job, and the header reads "Jobs 1–<number of jobs>"

#### Scenario: Cell colours
- **WHEN** a group has a completed, a failed, a cancelled, a pending and a processing job
- **THEN** the completed job's cell has the completed colour, the failed and cancelled jobs' cells the failed colour, and the pending and processing jobs' cells the remaining colour

#### Scenario: No jobs in the group
- **WHEN** a user opens the page of a group that has no jobs yet
- **THEN** the page shows "No jobs in this group yet" and no cells

### Requirement: A job's cell shows and opens the job
Hovering or focusing a job's cell SHALL show the job's short id and status, and clicking it SHALL
open the job's page.

#### Scenario: Cell tooltip
- **WHEN** a user hovers over or focuses a job's cell
- **THEN** the job's short id and status are shown

#### Scenario: Open a job from its cell
- **WHEN** a user clicks a job's cell
- **THEN** that job's page opens

### Requirement: The group pages update by polling
The groups list and the group page SHALL fetch their data again at the configured polling interval,
so changes appear without a reload, and SHALL show a live indicator. The group page's cells come
from the jobs themselves and its counts from the group, so after a poll they MAY briefly differ.

#### Scenario: Status change appears in the groups list
- **WHEN** a group shown in the groups list changes status on the server
- **THEN** after the next poll the list shows the new status without a reload

#### Scenario: Progress appears on the group page
- **WHEN** a job of the group whose page is open completes on the server
- **THEN** after the next poll its cell has the completed colour without a reload

### Requirement: A failed group poll keeps the last data
If a poll of the groups list or of a group page fails after data was shown, the page SHALL keep
showing the last data and SHALL show "Connection lost, retrying" next to the live indicator; polling
SHALL continue, and the note SHALL go away after the next successful poll.

#### Scenario: API unreachable while polling groups
- **WHEN** a poll of the groups list fails after groups were shown
- **THEN** the groups stay on screen and "Connection lost, retrying" is shown next to the live indicator

#### Scenario: API unreachable while polling a group
- **WHEN** a poll of a group page fails after the group was shown
- **THEN** the group and its cells stay on screen and "Connection lost, retrying" is shown next to the live indicator

#### Scenario: Group jobs fail to load
- **WHEN** a user opens a group page, the group loads and the first request for its jobs fails
- **THEN** the group, its counts and details are shown, "Could not load the jobs" is shown where the cells go, and "Connection lost, retrying" is shown next to the live indicator

#### Scenario: Group jobs load after a failed first load
- **WHEN** a poll for the group's jobs succeeds after the first request for them failed
- **THEN** the cells are shown and "Could not load the jobs" is no longer shown

#### Scenario: Group API back again
- **WHEN** a poll of a group page succeeds after a failed one
- **THEN** the "Connection lost, retrying" note is no longer shown

### Requirement: A failed first load of a group page can be reloaded
If the first load of the groups list or of a group page fails with an error other than "group not
found", the page SHALL show "Something went wrong" with a Reload button instead of the data; Reload
SHALL load the data again, and the page SHALL show the data once a load succeeds. While a group
loads, its page SHALL show skeleton cards.

#### Scenario: Groups list fails to load
- **WHEN** a user opens the groups list and the first request for groups fails
- **THEN** the page shows "Something went wrong" and a Reload button instead of the table

#### Scenario: Group page fails to load
- **WHEN** a user opens a group page and the first request for the group fails with an error other than "group not found"
- **THEN** the page shows "Something went wrong" and a Reload button instead of the group

#### Scenario: Reload a group after a failed load
- **WHEN** a user presses Reload on a group page and the next request succeeds
- **THEN** the page shows the group

#### Scenario: Loading a group
- **WHEN** the group page is waiting for its first answer from the API
- **THEN** skeleton cards are shown

### Requirement: The group page handles unknown groups
A group id that matches no group and an id that is not a UUID SHALL show "Group not found" with a
link back to Groups. An id that is not a UUID SHALL NOT be sent to the API.

#### Scenario: Unknown group id
- **WHEN** a user opens `/groups/<uuid>` for a UUID that matches no group
- **THEN** the page shows "Group not found" and a link back to Groups

#### Scenario: Malformed group id
- **WHEN** a user opens `/groups/abc`
- **THEN** the page shows "Group not found" and a link back to Groups, and no request for that group is made
