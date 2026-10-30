# Spec Delta

## ADDED Requirements

### Requirement: The job page shows the job's log
The job page SHALL show a "Log" card below the Lifecycle timeline, and the completed transit report
page SHALL show the same card at its bottom. The card lists the job's log entries oldest first, each
row showing the time, a level badge, the attempt, the message and its metadata, which can be expanded.

#### Scenario: Log of a completed job
- **WHEN** a user opens the page of a completed job with log entries
- **THEN** a Log card below the Lifecycle shows one row per entry, oldest first, with time, level badge, attempt and message

#### Scenario: Expand an entry's metadata
- **WHEN** the user expands a log row
- **THEN** the row shows the entry's metadata

#### Scenario: Log on the transit report
- **WHEN** a user opens the page of a completed transit job
- **THEN** the transit report shows the Log card at its bottom with the job's entries

### Requirement: New log entries appear while the page is open
While the job page is open, the Log card SHALL fetch only the entries written after the last one it
shows, at the configured polling interval, and add them at the end without a reload.

#### Scenario: New entry appears
- **WHEN** a new entry is written to the log of the job whose page is open
- **THEN** after the next poll the Log card shows it as its last row, and the rows shown before stay in place

### Requirement: The log can be filtered by level in the UI
The Log card SHALL offer the buttons All, Info, Warning and Error. Exactly one is chosen at a time and
shown pressed; All is chosen at first. With a level chosen the card shows only entries of that level.

#### Scenario: Show only errors
- **WHEN** the user clicks Error in the Log card of a job with entries of every level
- **THEN** the card shows only the `error` entries and the Error button is pressed

#### Scenario: Back to all
- **WHEN** the user clicks All after choosing a level
- **THEN** the card shows entries of every level again

### Requirement: The Log card handles loading, empty and unavailable logs
While its first request loads the Log card SHALL show skeleton rows. With no entries it SHALL show
"No log entries yet" when All is chosen and "No info entries", "No warning entries" or "No error
entries" when a level is chosen. When the API reports the log unavailable it SHALL show "Log
unavailable" in the card, and the rest of the job page SHALL keep working.

#### Scenario: Loading the log
- **WHEN** the Log card is waiting for its first answer from the API
- **THEN** it shows skeleton rows

#### Scenario: No entries yet
- **WHEN** the log of the job has no entries and All is chosen
- **THEN** the Log card shows "No log entries yet"

#### Scenario: No entries of the chosen level
- **WHEN** the user chooses Warning and the job has no `warning` entries
- **THEN** the Log card shows "No warning entries"

#### Scenario: Log unavailable
- **WHEN** the log route answers that the log store is unavailable
- **THEN** the Log card shows "Log unavailable" and the job's payload, details and Lifecycle are still shown
