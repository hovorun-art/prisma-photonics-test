# Proposal

## Why

job-ui shows job groups but cannot create them: today only API clients create a group and submit its
jobs. A user of the UI should be able to put together a group of jobs (for example a small email
campaign) and follow it on the group page, without writing API calls by hand.

## What Changes

- A "New group" button in the app frame's header, next to "New job", opens a page for creating a
  group.
- On that page the user builds the group's jobs item by item with the existing job forms (Email,
  Webhook, Aircraft transit), can duplicate an item, and then creates the group.
- Creating follows the API's client flow: create an empty group in job-group-service, submit all the
  jobs in one bulk request to job-service with the group's id, and delete the still-empty group if
  the bulk submit fails. On success the new group's page opens.
- No request preview (cURL / example response) on this page.
- The group pages are no longer read only in the sense of the `job-group-ui` decision "no create of
  groups in the UI"; deleting groups stays out of the UI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `job-ui`: the app frame gets a "New group" button; a new page to build and create a group with its
  jobs, with its validation, error and failure handling.

## Impact

- `apps/job-ui`: new page and route (under `features/groups`), header button, groups API gains
  create and delete, jobs API gains bulk create, new strings in `locales/en.ts`, unit and Playwright
  tests.
- No backend or contract changes expected: `POST /v1/groups`, `DELETE /v1/groups/:id` and
  `POST /v1/jobs/bulk` with `groupId` already exist.
