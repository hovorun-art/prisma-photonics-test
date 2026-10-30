# Spec Delta

## ADDED Requirements

### Requirement: Users can choose when a job runs
"3. Execution" on the submit page SHALL offer the run choice "Immediately" and "At a specific
time", with "Immediately" selected when the page opens. With "Immediately" the request SHALL carry
no execution time. Choosing "At a specific time" SHALL show a date and time input in the browser's
local time zone, with a hint naming that time zone; the chosen time SHALL be sent as the request's
`scheduledAt`, as the same instant in UTC.

#### Scenario: Immediately at first
- **WHEN** a user opens the submit page
- **THEN** "Immediately" is selected, no date and time input is shown, and the request preview has no `scheduledAt`

#### Scenario: Choose a specific time
- **WHEN** a user chooses "At a specific time"
- **THEN** a date and time input is shown under the choice, with a hint naming the browser's time zone

#### Scenario: Submit a scheduled job
- **WHEN** a user fills a valid email job, chooses "At a specific time", enters a local date and time in the future and clicks "Submit job"
- **THEN** the job is created with `scheduledAt` set to that local time as a UTC timestamp, and the new job's page opens

#### Scenario: Back to immediately
- **WHEN** a user chooses "At a specific time", enters a time, then chooses "Immediately" and submits
- **THEN** the job is created without `scheduledAt`

### Requirement: The scheduled time is validated before sending
With "At a specific time" chosen, the form SHALL reject an empty time, a time that is not after the
current time, and a time further ahead than the contract's configured maximum, each with its own
message under the time input, and SHALL send nothing while the time is rejected. An API
`VALIDATION_FAILED` issue on `scheduledAt` SHALL be shown under the time input.

#### Scenario: No time entered
- **WHEN** a user chooses "At a specific time", leaves the time empty and clicks "Submit job"
- **THEN** the time input shows "Choose a date and time" under it and no request is sent

#### Scenario: Time in the past
- **WHEN** a user chooses "At a specific time", enters a time before the current time and clicks "Submit job"
- **THEN** the time input shows "Choose a time in the future" under it and no request is sent

#### Scenario: Time too far ahead
- **WHEN** a user chooses "At a specific time", enters a time further ahead than the configured maximum and clicks "Submit job"
- **THEN** the time input shows "Choose a time within <n> days", with the configured number of days, and no request is sent

#### Scenario: API validation error on the scheduled time
- **WHEN** the API answers a submit with `VALIDATION_FAILED` and an issue for `scheduledAt`
- **THEN** the time input shows the issue's message and the entered values stay

### Requirement: The request preview shows the scheduled time
With "At a specific time" chosen and a time entered, the request preview and its cURL SHALL include
`scheduledAt` as it will be sent, and the example response SHALL show status `scheduled` and that
`scheduledAt`.

#### Scenario: Preview of a scheduled request
- **WHEN** a user chooses "At a specific time" and enters a time
- **THEN** the request preview and the copied cURL contain `scheduledAt` with that time in UTC, and the example response shows status `scheduled` and the same `scheduledAt`

### Requirement: The jobs list shows when a scheduled job runs
For a job in status `scheduled`, the Status cell of the jobs list SHALL show the job's scheduled
time, as local date and time, under the status badge. Jobs in other statuses SHALL show only the
badge.

#### Scenario: Scheduled job in the list
- **WHEN** the list shows a job in status `scheduled`
- **THEN** its Status cell shows the scheduled badge and, under it, the job's scheduled time as local date and time

#### Scenario: Started scheduled job in the list
- **WHEN** the list shows a job that has a scheduled time and is no longer `scheduled`
- **THEN** its Status cell shows only the status badge

## MODIFIED Requirements

### Requirement: The job page shows a job
The job page SHALL show a breadcrumb "Jobs / <id>", the full id as its title with status and type
badges, a Payload card, a Result card for a completed job or an Error card for a failed job, and a
Details list with type, priority, attempts, created, "Scheduled for" (only for a job with a
scheduled time), started, finished and total time.

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

#### Scenario: Scheduled time on the job page
- **WHEN** a user opens the page of a job that has a scheduled time
- **THEN** the Details list shows "Scheduled for" with the scheduled time as local date and time, in the same format as Created

#### Scenario: No scheduled time on the job page
- **WHEN** a user opens the page of a job without a scheduled time
- **THEN** the Details list has no "Scheduled for" row

### Requirement: The job page shows the job's lifecycle
The job page SHALL show a Lifecycle timeline of the statuses `pending`, `processing` and the
job's final status, marking the steps the job has reached, with the time of each step that has one.
For a job created as `scheduled` (its scheduled time is after its creation time), a `scheduled`
step, reached at the creation time, SHALL take the place of the `pending` step.

#### Scenario: Lifecycle of a completed job
- **WHEN** a user opens the page of a completed job
- **THEN** the Lifecycle marks pending, processing and completed as reached, with the start and finish times

#### Scenario: Lifecycle of a pending job
- **WHEN** a user opens the page of a pending job
- **THEN** the Lifecycle marks pending as reached and processing as not reached yet

#### Scenario: Lifecycle of a scheduled job
- **WHEN** a user opens the page of a job in status `scheduled`
- **THEN** the Lifecycle shows scheduled, processing and completed, with scheduled reached at the creation time and processing and completed not reached yet

#### Scenario: Lifecycle of a completed scheduled job
- **WHEN** a user opens the page of a completed job that was created as `scheduled`
- **THEN** the Lifecycle marks scheduled, processing and completed as reached, with the creation, start and finish times, and shows no pending step

#### Scenario: Lifecycle of a job scheduled for a past time
- **WHEN** a user opens the page of a job whose scheduled time is not after its creation time
- **THEN** the Lifecycle shows pending, processing and the final step as for a job without a scheduled time

### Requirement: Features still to come are shown disabled
Design elements that need API features not built yet SHALL be shown muted and disabled, with a
"Coming soon" tooltip on hover and focus: search, Cancel and Retry, "Run again" on the transit
report and the idempotency key.

#### Scenario: Disabled search
- **WHEN** a user hovers over or focuses the search field on the jobs list
- **THEN** it is disabled and a "Coming soon" tooltip is shown

#### Scenario: Filters are not disabled
- **WHEN** a user opens the jobs list
- **THEN** the status and type filter buttons are enabled and show no "Coming soon" tooltip

#### Scenario: Statistics without data
- **WHEN** a user opens the jobs list
- **THEN** the queue statistics cards and the header API status pill are not disabled and show no "Coming soon" tooltip

#### Scenario: Disabled job types
- **WHEN** a user opens the submit page
- **THEN** the Webhook and Aircraft transit job types can be chosen and Email is selected

#### Scenario: Run again is disabled
- **WHEN** a user hovers over or focuses "Run again" on the report of a completed transit job
- **THEN** it is disabled and a "Coming soon" tooltip is shown

#### Scenario: Run choice is enabled
- **WHEN** a user opens the submit page
- **THEN** "Immediately" and "At a specific time" can be chosen and show no "Coming soon" tooltip

### Requirement: Users can choose the job type on the submit page
The "1. Job type" cards SHALL switch the form in place between Email, Webhook and Aircraft transit.
Choosing Webhook SHALL show `/jobs/new?type=webhook`, choosing Aircraft transit
`/jobs/new?type=flight-transit`, choosing Email `/jobs/new`; opening any of these URLs directly
SHALL show that type selected, and Back SHALL return to the previous type. Switching SHALL keep
Priority, Max attempts, the run choice and its time, and start the chosen type's payload
fields at their initial values.

#### Scenario: Choose Webhook
- **WHEN** a user on `/jobs/new` clicks the Webhook card
- **THEN** the Webhook card is selected, the payload section shows the webhook fields and the URL is `/jobs/new?type=webhook`

#### Scenario: Choose Aircraft transit
- **WHEN** a user on `/jobs/new` clicks the Aircraft transit card
- **THEN** the Aircraft transit card is selected, the payload section shows the transit fields and the URL is `/jobs/new?type=flight-transit`

#### Scenario: Direct link to the webhook form
- **WHEN** a user opens `/jobs/new?type=webhook` directly
- **THEN** the Webhook card is selected and the webhook fields are shown

#### Scenario: Direct link to the transit form
- **WHEN** a user opens `/jobs/new?type=flight-transit` directly
- **THEN** the Aircraft transit card is selected and the transit fields are shown

#### Scenario: Back to the previous type
- **WHEN** a user chooses Webhook on `/jobs/new` and presses the browser's Back button
- **THEN** the Email card is selected and the email fields are shown

#### Scenario: Switching keeps the execution settings
- **WHEN** a user changes Priority, types a subject, chooses Webhook and then Email again
- **THEN** Priority keeps the changed value and the email fields are empty

#### Scenario: Switching to transit keeps the execution settings
- **WHEN** a user changes Max attempts, picks an origin airport, chooses Email and then Aircraft transit again
- **THEN** Max attempts keeps the changed value and the origin airport is empty

#### Scenario: Switching keeps the scheduled time
- **WHEN** a user chooses "At a specific time", enters a time and chooses Webhook
- **THEN** "At a specific time" is still selected and the time input holds the entered time
