# Spec Delta

## ADDED Requirements

### Requirement: Jobs list shows queue statistics
The jobs list SHALL show the queue statistics from job-service in six cards, in this order and with
the existing labels and status colours: Pending, Processing, Scheduled, Completed (recent window),
Failed (recent window) and Throughput. The statistics SHALL be polled at the same configured
interval as the jobs list.

#### Scenario: Statistics shown
- **WHEN** a user opens the jobs list and job-service reports statistics
- **THEN** the six cards show the pending, processing, scheduled, completed, failed and throughput values in that order

#### Scenario: Statistics update by polling
- **WHEN** the statistics change on the server while the jobs list is open
- **THEN** after the next poll the cards show the new values without a reload

#### Scenario: Statistics loading
- **WHEN** a user opens the jobs list and the first statistics request has not answered yet
- **THEN** each card shows a skeleton instead of a value

### Requirement: Statistics values are formatted for reading
Counts SHALL be shown with thousands separators and the throughput with one decimal and a
per-minute unit.

#### Scenario: Large count
- **WHEN** job-service reports 1234 pending jobs
- **THEN** the Pending card shows `1,234`

#### Scenario: Throughput value
- **WHEN** job-service reports a throughput of 2.4 jobs per minute
- **THEN** the Throughput card shows `2.4/min`

### Requirement: Failed statistics requests
If a statistics poll fails after values were shown, the cards SHALL keep the last values. If the
first statistics request fails, each card SHALL show "—" until a poll succeeds. In both cases the
rest of the jobs list SHALL keep working.

#### Scenario: Statistics poll fails after values were shown
- **WHEN** a statistics poll fails after the cards showed values
- **THEN** the cards keep showing the last values and the jobs table still shows jobs

#### Scenario: First statistics request fails
- **WHEN** the first statistics request fails while the jobs list loads
- **THEN** each card shows "—" and the jobs table still shows jobs

#### Scenario: Statistics recover
- **WHEN** a statistics poll succeeds after the first request failed
- **THEN** the cards show the reported values

### Requirement: Header shows the API status
The header pill SHALL show the API status from the statistics poll: "API online" while the latest
statistics request succeeded and "API offline" when it failed. It SHALL no longer be shown as
disabled.

#### Scenario: API online
- **WHEN** the latest statistics request succeeded
- **THEN** the header pill reads "API online"

#### Scenario: API offline
- **WHEN** the latest statistics request failed
- **THEN** the header pill reads "API offline"

#### Scenario: API back online
- **WHEN** a statistics request succeeds after a failed one
- **THEN** the header pill reads "API online" again

## MODIFIED Requirements

### Requirement: Features not built yet are shown disabled
Design elements that need API features not built yet SHALL be shown muted and disabled, with a
"Coming soon" tooltip on hover and focus: status and type filters, search, Cancel and Retry, the
Aircraft transit job type, the idempotency key and "At a specific time".

#### Scenario: Disabled filter
- **WHEN** a user hovers over or focuses a status filter on the jobs list
- **THEN** it is disabled and a "Coming soon" tooltip is shown

#### Scenario: Statistics without data
- **WHEN** a user opens the jobs list
- **THEN** the queue statistics cards and the header API status pill are not disabled and show no "Coming soon" tooltip

#### Scenario: Disabled job types
- **WHEN** a user opens the submit page
- **THEN** the Aircraft transit job type is disabled, the Webhook job type can be chosen and Email is selected
