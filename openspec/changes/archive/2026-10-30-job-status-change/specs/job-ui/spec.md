# Spec Delta

## ADDED Requirements

### Requirement: Jobs that have not finished can be cancelled
The job page of a pending, scheduled or processing job SHALL show a "Cancel job" button; other jobs
SHALL NOT show it. Clicking it SHALL ask for confirmation; confirming cancels the job and the page
shows the job as `cancelled` at once, without waiting for the next poll. Closing the dialog without
confirming keeps the job as it was.

#### Scenario: Cancel a pending job
- **WHEN** a user clicks "Cancel job" on a pending job's page and confirms
- **THEN** a cancel request is sent for the job and the page shows the job with status cancelled

#### Scenario: Cancel a processing job
- **WHEN** a user opens the page of a processing job
- **THEN** a "Cancel job" button is shown

#### Scenario: Keep the job
- **WHEN** a user clicks "Cancel job" and then closes the dialog without confirming
- **THEN** the dialog closes, no cancel request is made and the job is unchanged

#### Scenario: No cancel for a finished job
- **WHEN** a user opens the page of a completed, failed or cancelled job
- **THEN** no "Cancel job" button is shown

#### Scenario: Cancel a job from the UI on the full system
- **WHEN** a user cancels a waiting job from its page on the full system
- **THEN** the page shows the job with status cancelled, and it stays cancelled after a reload

### Requirement: Failed jobs can be retried
The job page of a failed job SHALL show a "Retry job" button; other jobs SHALL NOT show it. Clicking
it SHALL retry the job without a confirmation, and the page SHALL show the job as `pending` with
zero attempts at once, without waiting for the next poll.

#### Scenario: Retry a failed job
- **WHEN** a user clicks "Retry job" on a failed job's page
- **THEN** a retry request is sent for the job and the page shows the job with status pending and zero attempts

#### Scenario: No retry for a job that has not failed
- **WHEN** a user opens the page of a pending, processing, completed or cancelled job
- **THEN** no "Retry job" button is shown

#### Scenario: Retry a job from the UI on the full system
- **WHEN** a user retries a failed job from its page on the full system
- **THEN** the page shows the job leaving the failed status and, later, finished again

### Requirement: Status change buttons wait for their request
While a cancel or retry request is in flight, its button (the dialog's confirm button for a cancel)
SHALL be disabled, so the request cannot be sent twice.

#### Scenario: Retry in flight
- **WHEN** a user clicks "Retry job" and the request has not been answered yet
- **THEN** the "Retry job" button is disabled until the answer arrives

#### Scenario: Cancel in flight
- **WHEN** a user confirms a cancel and the request has not been answered yet
- **THEN** the dialog's confirm button is disabled until the answer arrives

### Requirement: A failed status change is reported
If a cancel or retry request fails, the UI SHALL show the API's error message and keep showing the
job as it was: a failed cancel keeps the confirmation dialog open with the message, a failed retry
shows the message next to the job's actions.

#### Scenario: Cancel rejected
- **WHEN** a user confirms a cancel and the API answers with a status conflict because the job has finished meanwhile
- **THEN** the dialog stays open and shows the error message, and the page does not show the job as cancelled

#### Scenario: Retry rejected
- **WHEN** a user clicks "Retry job" and the API answers with an error
- **THEN** the error message is shown next to the job's actions and the job is still shown as failed

## MODIFIED Requirements

### Requirement: Features still to come are shown disabled
Design elements that need API features not built yet SHALL be shown muted and disabled, with a
"Coming soon" tooltip on hover and focus: search, "Run again" on the transit report, the
idempotency key and "At a specific time".

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

#### Scenario: Cancel and Retry are not disabled
- **WHEN** a user opens the page of a pending job or of a failed job
- **THEN** the "Cancel job" or "Retry job" button is enabled and shows no "Coming soon" tooltip
