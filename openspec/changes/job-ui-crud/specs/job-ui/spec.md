# Spec Delta

## Purpose

What a user can do with jobs in the web UI: see the list of jobs, open a job, submit an email job
and delete a finished job, and what the UI shows while loading, when empty and on errors.

## ADDED Requirements

### Requirement: Every page has the app frame
Every page of job-ui SHALL show a header with the product mark "Queue", navigation with "Jobs" and
"API docs", and a primary "New job" button. "Jobs" SHALL open the jobs list, "New job" the submit
page, and "API docs" SHALL open job-service's API documentation in a new tab.

#### Scenario: Header on every page
- **WHEN** a user opens the jobs list, a job page or the submit page
- **THEN** the page shows the product mark "Queue", the "Jobs" and "API docs" links and the "New job" button

#### Scenario: New job from the header
- **WHEN** a user clicks "New job" in the header
- **THEN** the submit page opens at `/jobs/new`

#### Scenario: API docs in a new tab
- **WHEN** a user looks at the "API docs" link
- **THEN** it points to job-service's API documentation and opens in a new tab

### Requirement: Pages have their own URLs
job-ui SHALL show the jobs list at `/jobs`, the submit page at `/jobs/new` and a job's page at
`/jobs/:id`. The start page `/` SHALL show the jobs list. Opening any of these URLs directly SHALL
show that page, and the browser's Back button SHALL return to the previous page.

#### Scenario: Start page is the jobs list
- **WHEN** a user opens job-ui at `/`
- **THEN** the jobs list is shown

#### Scenario: Direct link to a job
- **WHEN** a user opens `/jobs/<id>` of an existing job directly
- **THEN** that job's page is shown

#### Scenario: Back returns to the list
- **WHEN** a user opens a job from the list and then presses the browser's Back button
- **THEN** the jobs list is shown again

### Requirement: The jobs list shows jobs newest first
The jobs list SHALL show one page of jobs from the API, newest first, as a table with the columns
Job ID, Type, Status, Priority, Attempts, Details, Created and Actions. Job ID SHALL show a short
form of the id and link to the job's page; Status SHALL be a coloured badge; Attempts SHALL read
"attempts/max attempts"; Created SHALL be the local time of day.

#### Scenario: Jobs in the table
- **WHEN** a user opens the jobs list while jobs exist
- **THEN** each job of the first page is a row with its short id, type, status badge, priority, attempts as "attempts/max attempts", details and creation time, in the order the API returns them

#### Scenario: Open a job from the list
- **WHEN** a user clicks a job's short id in the list
- **THEN** the job's page opens

### Requirement: The Details column summarises an email job
For an email job the Details column SHALL show the recipient and subject while the job waits or
runs, the message id when it is completed, and the error message when it has failed.

#### Scenario: Waiting or running email job
- **WHEN** the list shows an email job in status `scheduled`, `pending` or `processing`
- **THEN** its Details read "to <address> · "<subject>""

#### Scenario: Completed email job
- **WHEN** the list shows a completed email job
- **THEN** its Details show the job's message id

#### Scenario: Failed email job
- **WHEN** the list shows a failed email job
- **THEN** its Details show the job's error message

### Requirement: The jobs list pages through all jobs
The list SHALL show one page of the API's default page size at a time, with Previous and Next
buttons and "Showing <from>–<to> of <total>". Previous SHALL be disabled on the first page and Next
on the last page.

#### Scenario: First page
- **WHEN** a user opens the jobs list while more jobs exist than fit on one page
- **THEN** the footer shows the range of the first page and the total, Previous is disabled and Next is enabled

#### Scenario: Next page
- **WHEN** a user clicks Next on the first page
- **THEN** the list shows the next page of jobs and Previous becomes enabled

#### Scenario: Last page
- **WHEN** a user is on the page that holds the oldest job
- **THEN** Next is disabled

### Requirement: The jobs list shows loading and empty states
While the first page loads the list SHALL show skeleton rows. When no job exists it SHALL show
"No jobs yet" with a "New job" button that opens the submit page.

#### Scenario: Loading
- **WHEN** the jobs list is waiting for its first answer from the API
- **THEN** skeleton rows are shown in the table

#### Scenario: No jobs
- **WHEN** a user opens the jobs list while no job exists
- **THEN** the list shows "No jobs yet" and a "New job" button that opens the submit page

### Requirement: The list and the job page update by polling
The jobs list and the job page SHALL fetch their data again at the configured polling interval, so
status changes appear without a reload, and SHALL show a live indicator.

#### Scenario: Status change appears in the list
- **WHEN** a job shown in the list changes status on the server
- **THEN** after the next poll the list shows the new status without a reload

#### Scenario: Status change appears on the job page
- **WHEN** the job whose page is open changes status on the server
- **THEN** after the next poll the page shows the new status without a reload

### Requirement: A failed poll keeps the last data
If a poll fails after data was shown, the page SHALL keep showing the last data and SHALL show
"Connection lost, retrying" next to the live indicator; polling SHALL continue, and the note SHALL
go away after the next successful poll.

#### Scenario: API unreachable while polling
- **WHEN** a poll of the jobs list fails after jobs were shown
- **THEN** the jobs stay on screen and "Connection lost, retrying" is shown next to the live indicator

#### Scenario: API back again
- **WHEN** a poll succeeds after a failed one
- **THEN** the "Connection lost, retrying" note is no longer shown

### Requirement: The job page shows a job
The job page SHALL show a breadcrumb "Jobs / <id>", the full id as its title with status and type
badges, a Payload card, a Result card for a completed job or an Error card for a failed job, and a
Details list with type, priority, attempts, created, started, finished and total time.

#### Scenario: Completed job
- **WHEN** a user opens the page of a completed job
- **THEN** the page shows the full id, a completed status badge, the type badge, the payload, the result and the details

#### Scenario: Failed job
- **WHEN** a user opens the page of a failed job
- **THEN** the page shows an alert box with the number of attempts made and the error message, and an Error card with the job's error

#### Scenario: Waiting job
- **WHEN** a user opens the page of a pending job
- **THEN** the page shows the payload, and the Details list shows no started or finished time

#### Scenario: Times on the job page
- **WHEN** the page shows a job that has started and finished
- **THEN** created, started and finished are local date and time, and Total time is the time from started to finished

### Requirement: The job page shows the job's lifecycle
The job page SHALL show a Lifecycle timeline of the statuses `pending`, `processing` and the
job's final status, marking the steps the job has reached, with the time of each step that has one.

#### Scenario: Lifecycle of a completed job
- **WHEN** a user opens the page of a completed job
- **THEN** the Lifecycle marks pending, processing and completed as reached, with the start and finish times

#### Scenario: Lifecycle of a pending job
- **WHEN** a user opens the page of a pending job
- **THEN** the Lifecycle marks pending as reached and processing as not reached yet

### Requirement: The job page handles unknown jobs
While the job loads the page SHALL show skeleton cards. A job id that matches no job, an id that is
not a UUID, and a job that disappears while its page is open SHALL show "Job not found" with a link
back to Jobs. An id that is not a UUID SHALL NOT be sent to the API.

#### Scenario: Loading a job
- **WHEN** the job page is waiting for its first answer from the API
- **THEN** skeleton cards are shown

#### Scenario: Unknown job id
- **WHEN** a user opens `/jobs/<uuid>` for a UUID that matches no job
- **THEN** the page shows "Job not found" and a link back to Jobs

#### Scenario: Malformed job id
- **WHEN** a user opens `/jobs/abc`
- **THEN** the page shows "Job not found" and a link back to Jobs, and no request for that job is made

#### Scenario: Job deleted while open
- **WHEN** the job whose page is open is deleted elsewhere and the next poll answers that it does not exist
- **THEN** the page shows "Job not found" and a link back to Jobs

### Requirement: Job data can be copied
The Payload card and the Error or Result card SHALL each have a Copy button that copies its JSON,
and the job page SHALL have a "Copy as cURL" button that copies a curl command fetching the job.
A copy button SHALL confirm by reading "Copied" for a moment.

#### Scenario: Copy the payload
- **WHEN** a user clicks Copy on the Payload card
- **THEN** the clipboard holds the payload as JSON and the button reads "Copied" for a moment

#### Scenario: Copy as cURL
- **WHEN** a user clicks "Copy as cURL" on a job page
- **THEN** the clipboard holds a curl command that gets this job from the API

### Requirement: Finished jobs can be deleted
The job page of a completed, failed or cancelled job SHALL show a danger-style "Delete job" button;
other jobs SHALL NOT show it. Clicking it SHALL ask for confirmation; confirming deletes the job and
opens the jobs list, cancelling closes the dialog and keeps the job.

#### Scenario: Delete a finished job
- **WHEN** a user clicks "Delete job" on a completed job's page and confirms
- **THEN** the job is deleted and the jobs list opens without it

#### Scenario: Cancel the confirmation
- **WHEN** a user clicks "Delete job" and then cancels the dialog
- **THEN** the dialog closes, no delete request is made and the job page stays

#### Scenario: No delete for an unfinished job
- **WHEN** a user opens the page of a pending or processing job
- **THEN** no "Delete job" button is shown

### Requirement: A failed delete is reported in the dialog
If the delete request fails, the confirmation dialog SHALL stay open and show the API's error
message. If the API answers that the job does not exist, the UI SHALL open the jobs list as after a
successful delete.

#### Scenario: Delete rejected
- **WHEN** a user confirms a delete and the API answers with an error other than "job not found"
- **THEN** the dialog stays open and shows the error message

#### Scenario: Already deleted
- **WHEN** a user confirms a delete and the API answers that the job does not exist
- **THEN** the jobs list opens

### Requirement: Users can submit an email job
The submit page SHALL show a breadcrumb "Jobs / New job" and a form in three sections: "1. Job
type" (Email selected), "2. Payload" (To, Subject, Body) and "3. Execution" (Priority, Max
attempts, prefilled with the API's defaults), with Cancel and "Submit job" buttons. Submitting a
valid form SHALL create the job and open its page.

#### Scenario: Submit a valid email job
- **WHEN** a user fills To, Subject and Body with valid values and clicks "Submit job"
- **THEN** the job is created with the entered values and the new job's page opens

#### Scenario: Defaults in the form
- **WHEN** a user opens the submit page
- **THEN** Priority and Max attempts hold the API's default values

#### Scenario: Cancel the form
- **WHEN** a user clicks Cancel on the submit page
- **THEN** the jobs list opens and no job is created

### Requirement: The submit form is validated before sending
The form SHALL check its values with the same rules as the API before sending. An invalid field
SHALL be shown in red with its error message under it, and nothing SHALL be sent while a field is
invalid.

#### Scenario: Invalid email address
- **WHEN** a user enters a To value that is not an email address and clicks "Submit job"
- **THEN** the To field shows an error under it and no request is sent

#### Scenario: Priority out of range
- **WHEN** a user enters a priority outside the allowed range and clicks "Submit job"
- **THEN** the Priority field shows an error under it and no request is sent

#### Scenario: Missing subject
- **WHEN** a user leaves Subject empty and clicks "Submit job"
- **THEN** the Subject field shows an error under it and no request is sent

### Requirement: API errors on submit are shown
If the API rejects a submit with `VALIDATION_FAILED`, each issue SHALL be shown under its field.
Any other API error SHALL be shown as an alert above the buttons. The entered values SHALL stay.

#### Scenario: API validation error
- **WHEN** the API answers a submit with `VALIDATION_FAILED` and an issue for a payload field
- **THEN** that field shows the issue's message and the entered values stay

#### Scenario: Other API error
- **WHEN** the API answers a submit with any other error
- **THEN** an alert above the buttons shows the error message and the entered values stay

### Requirement: The submit page previews the request
Next to the form the submit page SHALL show the request it will send, updated as the user types,
with a "Copy cURL" button that copies it as a curl command, and an example `201 Created` response
built from the form values, marked as an example.

#### Scenario: Preview follows the form
- **WHEN** a user types a subject
- **THEN** the request preview shows the typed subject in the request body

#### Scenario: Copy cURL
- **WHEN** a user clicks "Copy cURL"
- **THEN** the clipboard holds a curl command that submits the previewed request, and the button reads "Copied" for a moment

#### Scenario: Example response
- **WHEN** a user opens the submit page
- **THEN** the Response box shows an example `201 Created` body with status `pending`, attempts zero and the form's priority and max attempts, marked as an example

### Requirement: Features not built yet are shown disabled
Design elements that need API features not built yet SHALL be shown muted and disabled, with a
"Coming soon" tooltip on hover and focus: the queue statistics cards (showing "—"), the "API
status —" pill, status and type filters, search, Cancel and Retry, the Webhook and Aircraft
transit job types, the idempotency key and "At a specific time".

#### Scenario: Disabled filter
- **WHEN** a user hovers over or focuses a status filter on the jobs list
- **THEN** it is disabled and a "Coming soon" tooltip is shown

#### Scenario: Statistics without data
- **WHEN** a user opens the jobs list
- **THEN** the queue statistics cards show "—" instead of numbers and the header pill reads "API status —"

#### Scenario: Disabled job types
- **WHEN** a user opens the submit page
- **THEN** the Webhook and Aircraft transit job types are disabled and Email is selected
