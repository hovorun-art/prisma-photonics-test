# Spec Delta

## MODIFIED Requirements

### Requirement: Every page has the app frame
Every page of job-ui SHALL show a header with the product mark "Queue", navigation with "Jobs",
"Groups" and "API docs", a "New group" button and a primary "New job" button. "Jobs" SHALL open the
jobs list, "Groups" the groups list, "New job" the submit page, "New group" the new group page, and
"API docs" SHALL open job-service's API documentation in a new tab.

#### Scenario: Header on every page
- **WHEN** a user opens the jobs list, a job page, the submit page, the groups list, a group page or the new group page
- **THEN** the page shows the product mark "Queue", the "Jobs", "Groups" and "API docs" links and the "New group" and "New job" buttons

#### Scenario: New job from the header
- **WHEN** a user clicks "New job" in the header
- **THEN** the submit page opens at `/jobs/new`

#### Scenario: New group from the header
- **WHEN** a user clicks "New group" in the header
- **THEN** the new group page opens at `/groups/new`

#### Scenario: Groups from the header
- **WHEN** a user clicks "Groups" in the header
- **THEN** the groups list opens at `/groups`

#### Scenario: API docs in a new tab
- **WHEN** a user looks at the "API docs" link
- **THEN** it points to job-service's API documentation and opens in a new tab

### Requirement: Pages have their own URLs
job-ui SHALL show the jobs list at `/jobs`, the submit page at `/jobs/new`, a job's page at
`/jobs/:id`, the groups list at `/groups`, the new group page at `/groups/new` and a group's page
at `/groups/:id`. The start page `/` SHALL show the jobs list. Opening any of these URLs directly
SHALL show that page, and the browser's Back button SHALL return to the previous page.

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

#### Scenario: Direct link to the new group page
- **WHEN** a user opens `/groups/new` directly
- **THEN** the new group page is shown, not a group page

### Requirement: The groups list shows loading and empty states
While the first page loads the groups list SHALL show skeleton rows. When no group exists it SHALL
show "No groups yet" with a hint that mentions "New group".

#### Scenario: Loading groups
- **WHEN** the groups list is waiting for its first answer from the API
- **THEN** skeleton rows are shown in the table

#### Scenario: No groups
- **WHEN** a user opens the groups list while no group exists
- **THEN** the list shows "No groups yet" and a hint that mentions "New group"

## ADDED Requirements

### Requirement: The new group page holds one tab per job
The new group page SHALL follow the submit page's layout without a request preview: a breadcrumb
"Groups / New group", a row of tabs, one per job of the group, and the open tab's job form below.
It SHALL open with one tab "Job 1 · Email" at the submit page's initial values. Each tab SHALL read
"Job N · <type>", numbered in tab order.

#### Scenario: New group page at first
- **WHEN** a user opens the new group page
- **THEN** it shows the breadcrumb "Groups / New group", one tab "Job 1 · Email" that is open, the email form with the submit page's initial values, and no request preview

#### Scenario: Tab label follows the type
- **WHEN** a user chooses Webhook in the form of the open tab "Job 1 · Email"
- **THEN** the tab reads "Job 1 · Webhook"

### Requirement: A tab's form is the job form
A tab's form SHALL have the submit page's "1. Job type", "2. Payload" and "3. Execution" sections
with Email, Webhook and Aircraft transit, the same initial values, validation rules and messages.
Switching the type in a tab SHALL keep its Priority and Max attempts and start the payload fields
at their initial values, without changing the page URL. Each tab SHALL keep its own values.

#### Scenario: Switching type in a tab keeps the execution settings
- **WHEN** a user changes Priority in a tab, chooses Webhook and then Email again
- **THEN** Priority keeps the changed value, the email fields are empty and the URL is still `/groups/new`

#### Scenario: Each tab keeps its own values
- **WHEN** a user types a subject in Job 1, adds a job, and opens Job 1 again
- **THEN** Job 1 shows the typed subject and Job 2 shows the initial values

### Requirement: Users can add, duplicate and remove jobs
A "+" tab SHALL add an Email job at initial values at the end and open it. Each tab's form SHALL
have a "Duplicate" button that inserts a copy of that job with the same values right after it.
Each tab SHALL have a × that removes its job, hidden while only one tab is left;
removing the open tab SHALL open the tab before it, or the new first tab.

#### Scenario: Add a job
- **WHEN** a user clicks "+" on a page with one tab
- **THEN** a tab "Job 2 · Email" is added and opened with the initial values

#### Scenario: Duplicate a job
- **WHEN** a user with tabs Job 1 and Job 2 fills Job 1 with a webhook URL and clicks "Duplicate" in it
- **THEN** a new "Job 2 · Webhook" with the same URL is opened right after Job 1, and the former Job 2 is now Job 3

#### Scenario: Remove a job
- **WHEN** a user has three tabs, opens Job 2 and clicks its ×
- **THEN** two tabs are left, numbered Job 1 and Job 2, and Job 1 is open

#### Scenario: Remove the first job
- **WHEN** a user has two tabs, opens Job 1 and clicks its ×
- **THEN** one tab is left, "Job 1", it holds the former Job 2's values and is open

#### Scenario: Last job cannot be removed
- **WHEN** the page has only one tab
- **THEN** that tab shows no ×

### Requirement: A group holds at most the configured number of jobs
When the group has the configured maximum number of jobs, "+" and every "Duplicate" SHALL be
disabled and a hint SHALL name the maximum. Removing a job SHALL enable them again.

#### Scenario: At the maximum
- **WHEN** a user has added jobs up to the configured maximum
- **THEN** "+" and "Duplicate" are disabled and a hint names the maximum

#### Scenario: Below the maximum again
- **WHEN** a user at the configured maximum removes a job
- **THEN** "+" and "Duplicate" are enabled again and the hint is gone

### Requirement: Users can create the group with its jobs
The page SHALL have Cancel and a "Create group (N jobs)" button, N being the number of tabs. Creating
SHALL create a group, submit all its jobs in one request with that group's id in tab order, and on
success open the new group's page. While creating, the button SHALL show a busy state and SHALL not
start a second creation. Cancel SHALL open the groups list and create nothing.

#### Scenario: Create a group with two jobs
- **WHEN** a user fills Job 1 as a valid email job and Job 2 as a valid webhook job and clicks "Create group (2 jobs)"
- **THEN** a group is created, both jobs are submitted with the group's id in tab order, and the new group's page opens

#### Scenario: Busy while creating
- **WHEN** a user clicks "Create group" and the API has not answered yet
- **THEN** the button shows a busy state and clicking it again sends nothing

#### Scenario: Cancel the new group
- **WHEN** a user clicks Cancel on the new group page
- **THEN** the groups list opens and no group or job is created

### Requirement: Jobs are validated before the group is created
On "Create group" every tab SHALL be checked with the submit page's rules. When any is invalid,
nothing SHALL be sent, every tab with an invalid field SHALL be highlighted red, and the first such
tab SHALL open with its field errors under the fields. Editing a field SHALL clear its error, and a
tab SHALL lose its red highlight once it has no errors left.

#### Scenario: Invalid job in another tab
- **WHEN** Job 1 is valid, Job 2 has a To that is not an email address, Job 1 is open, and the user clicks "Create group"
- **THEN** no request is sent, Job 2's tab is highlighted red and opens, and its To field shows an error

#### Scenario: Several invalid tabs
- **WHEN** Job 2 and Job 3 have invalid fields and the user clicks "Create group"
- **THEN** Job 2 and Job 3 are highlighted red and Job 2 is open

#### Scenario: Fixing a tab clears its highlight
- **WHEN** a red tab has one invalid field and the user corrects it
- **THEN** the field's error is gone and the tab is no longer highlighted red

### Requirement: API errors on group creation are shown
If the job submit is rejected with `VALIDATION_FAILED`, each issue for a field of job n SHALL be
shown under that field in Job n's tab and that tab highlighted red; any other issue, a rejection
without issues, any other API error, and a failure to create the group SHALL be shown as an alert
above the buttons, naming an unreachable API as such. Every tab and value SHALL stay.

#### Scenario: API validation error on a job's field
- **WHEN** the job submit is answered with `VALIDATION_FAILED` and an issue for the second job's webhook URL
- **THEN** Job 2's tab is highlighted red and its URL field shows the issue's message, and all tabs keep their values

#### Scenario: API validation error not tied to a job's field
- **WHEN** the job submit is answered with `VALIDATION_FAILED` and an issue for the list of jobs as a whole
- **THEN** an alert above the buttons shows the issue's message

#### Scenario: Group cannot be created
- **WHEN** creating the group is answered with an error
- **THEN** an alert above the buttons shows the error message, no job is submitted and all tabs keep their values

#### Scenario: API unreachable
- **WHEN** the API cannot be reached on "Create group"
- **THEN** an alert above the buttons says the API is unreachable and all tabs keep their values

#### Scenario: Other API error on the job submit
- **WHEN** the job submit is answered with any error other than `VALIDATION_FAILED`
- **THEN** an alert above the buttons shows the error message and all tabs keep their values

### Requirement: A failed job submit leaves no group behind
When the job submit fails after the group was created, job-ui SHALL delete that group, which then has
no jobs. If that delete fails too, only the submit's error SHALL be shown. Creating again SHALL create
a new group.

#### Scenario: Group deleted after a failed submit
- **WHEN** the group is created and the job submit is answered with an error
- **THEN** the group is deleted and the submit's error is shown

#### Scenario: Delete fails after a failed submit
- **WHEN** the group is created, the job submit fails and deleting the group fails too
- **THEN** only the submit's error is shown above the buttons

#### Scenario: Try again after a failed submit
- **WHEN** a job submit failed and the user clicks "Create group" again
- **THEN** a new group is created and the jobs are submitted with the new group's id
