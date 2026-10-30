# Spec Delta

## MODIFIED Requirements

### Requirement: The jobs list shows loading and empty states
While the first page loads the list SHALL show skeleton rows. When no job exists and both filters
are All it SHALL show "No jobs yet" with a "New job" button that opens the submit page. When a
status or type filter is chosen and no job matches, it SHALL show "No jobs match these filters"
with a "Clear filters" button that sets both filters back to All.

#### Scenario: Loading
- **WHEN** the jobs list is waiting for its first answer from the API
- **THEN** skeleton rows are shown in the table

#### Scenario: No jobs
- **WHEN** a user opens the jobs list while no job exists
- **THEN** the list shows "No jobs yet" and a "New job" button that opens the submit page

#### Scenario: No job matches the filters
- **WHEN** a user chooses the status Failed while no failed job exists
- **THEN** the list shows "No jobs match these filters" and a "Clear filters" button, and not "No jobs yet"

#### Scenario: Clear filters
- **WHEN** a user clicks "Clear filters" while the status Failed and the type Webhook are chosen
- **THEN** both filters are All and the list shows jobs of every status and type

## ADDED Requirements

### Requirement: Features still to come are shown disabled
Design elements that need API features not built yet SHALL be shown muted and disabled, with a
"Coming soon" tooltip on hover and focus: search, Cancel and Retry, "Run again" on the transit
report, the idempotency key and "At a specific time".

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


### Requirement: Users can filter the jobs list by status
The jobs list SHALL offer the status filter buttons All, Scheduled, Pending, Processing, Completed,
Failed and Cancelled. Exactly one is chosen at a time and shown pressed; All is chosen at first.
With a status chosen the list SHALL show only jobs in that status.

#### Scenario: Status filter buttons
- **WHEN** a user opens the jobs list
- **THEN** the status filter shows All, Scheduled, Pending, Processing, Completed, Failed and Cancelled, with All pressed

#### Scenario: Filter by status
- **WHEN** a user clicks Failed while failed and completed jobs exist
- **THEN** Failed is pressed, All is not, and the list shows only the failed jobs

#### Scenario: Back to all statuses
- **WHEN** a user clicks All after choosing Failed
- **THEN** All is pressed and the list shows jobs of every status

### Requirement: Users can filter the jobs list by type
The jobs list SHALL offer the type filter buttons All types, Email, Webhook and Aircraft transit,
one for each job type that exists. Exactly one is chosen at a time and shown pressed; All types is
chosen at first. With a type chosen the list SHALL show only jobs of that type.

#### Scenario: Type filter buttons
- **WHEN** a user opens the jobs list
- **THEN** the type filter shows All types, Email, Webhook and Aircraft transit, with All types pressed, and no Batch button

#### Scenario: Filter by type
- **WHEN** a user clicks Webhook while email and webhook jobs exist
- **THEN** Webhook is pressed and the list shows only the webhook jobs

### Requirement: Status and type filters combine on the list
With a status and a type chosen, the list SHALL show only jobs in that status and of that type,
and the pager's range and total SHALL count only those jobs.

#### Scenario: Status and type together
- **WHEN** a user chooses Failed and Webhook while failed email jobs and completed webhook jobs also exist
- **THEN** the list shows only the failed webhook jobs and the footer's total is their number

#### Scenario: Paging through a filtered list
- **WHEN** a user chooses Failed while more failed jobs exist than fit on one page, and clicks Next
- **THEN** the next page shows only failed jobs and the footer's total is the number of failed jobs

### Requirement: Changing a filter returns to the first page
When the user changes the status or type filter, the list SHALL show the first page of the newly
filtered jobs.

#### Scenario: Filter change on a later page
- **WHEN** a user is on the second page of the list and clicks Failed
- **THEN** the list shows the first page of failed jobs and Previous is disabled

### Requirement: The chosen filters are kept in the page URL
The jobs list URL SHALL carry the chosen filters as `status` and `type` parameters (for example
`/jobs?status=failed&type=webhook`), leaving out a filter set to All. Opening such a URL SHALL show
the list with those filters chosen; each filter change SHALL be a browser history step, so Back
restores the previous filters. A `status` or `type` value that is not a known job status or type
SHALL be treated as All and not sent to the API.

#### Scenario: Filters in the URL
- **WHEN** a user chooses Failed and Webhook
- **THEN** the page URL is `/jobs?status=failed&type=webhook`

#### Scenario: Open a filtered link
- **WHEN** a user opens `/jobs?status=failed&type=webhook` directly
- **THEN** Failed and Webhook are pressed and the list shows only the failed webhook jobs

#### Scenario: Reload keeps the filters
- **WHEN** a user reloads the page after choosing Failed
- **THEN** Failed is still pressed and the list shows only the failed jobs

#### Scenario: Back restores the previous filter
- **WHEN** a user chooses Failed, then Completed, then presses the browser's Back button
- **THEN** Failed is pressed again and the list shows only the failed jobs

#### Scenario: Unknown filter value in the URL
- **WHEN** a user opens `/jobs?status=unknown`
- **THEN** All is pressed, the list shows jobs of every status, and the API is queried without a status filter

### Requirement: Filter buttons show job counts
Each filter button SHALL show, as a muted number after its label, how many jobs clicking it would
list: a status button counts the jobs in that status under the chosen type, a type button the jobs
of that type under the chosen status, All the jobs of the chosen type, and All types the jobs in
the chosen status. Counts SHALL use the thousands separators of the statistics cards.

#### Scenario: Counts without filters
- **WHEN** a user opens the jobs list while two failed webhook jobs and one completed email job exist
- **THEN** the status buttons read All 3, Failed 2, Completed 1 and 0 for the other statuses, and the type buttons read All types 3, Webhook 2, Email 1 and Aircraft transit 0

#### Scenario: Status counts follow the type filter
- **WHEN** a user chooses Webhook while two failed webhook jobs and one failed email job exist
- **THEN** the Failed button reads 2 and the All button reads 2, while the Webhook button reads 2 and the Email button reads 1

#### Scenario: Type counts follow the status filter
- **WHEN** a user chooses Failed while two failed webhook jobs and one completed email job exist
- **THEN** the Webhook button reads 2, the Email button reads 0 and the All types button reads 2

#### Scenario: Large count on a filter button
- **WHEN** job-service reports 1234 failed jobs
- **THEN** the Failed button shows `1,234`

### Requirement: Filter counts while loading or failing
The filter buttons SHALL show no count until the statistics for the chosen filters arrive, and none
when the first statistics request fails; the filters SHALL still work. When a filter changes, the
buttons SHALL show no count until the counts for the new filters arrive, while the statistics cards
keep their last values. A failed statistics poll SHALL keep the last counts.

#### Scenario: Counts loading
- **WHEN** a user opens the jobs list and the first statistics request has not answered yet
- **THEN** the filter buttons show their labels without counts and can be clicked

#### Scenario: Counts unavailable
- **WHEN** the first statistics request fails
- **THEN** the filter buttons show their labels without counts, and choosing a filter still narrows the list

#### Scenario: Counts after a filter change
- **WHEN** a user chooses Webhook and the statistics for that filter have not answered yet
- **THEN** the filter buttons show no counts and the statistics cards keep their last values

#### Scenario: Counts kept on a failed poll
- **WHEN** a statistics poll fails after the filter buttons showed counts
- **THEN** the buttons keep showing the last counts

### Requirement: Filters do not change the statistics cards
The six queue statistics cards SHALL show the same values whichever filters are chosen.

#### Scenario: Cards under a filter
- **WHEN** a user chooses Failed and Webhook
- **THEN** the statistics cards show the same values as with both filters set to All

### Requirement: The filtered list and counts update by polling
The filtered list and the filter counts SHALL be polled at the configured polling interval with
the chosen filters. A failed poll SHALL keep the last filtered page as the unfiltered list does.

#### Scenario: New matching job appears
- **WHEN** Failed is chosen and another job fails on the server
- **THEN** after the next poll the list shows it and the Failed count has grown by one, without a reload

#### Scenario: Failed poll under a filter
- **WHEN** Failed is chosen and a poll of the list fails after failed jobs were shown
- **THEN** the failed jobs stay on screen and "Connection lost, retrying" is shown next to the live indicator

## REMOVED Requirements

### Requirement: Features not built yet are shown disabled
**Reason**: The status and type filters are built now; the requirement is replaced by "Features still to come are shown disabled", which lists only the features still missing.
**Migration**: None for users; the status and type filters are enabled.
