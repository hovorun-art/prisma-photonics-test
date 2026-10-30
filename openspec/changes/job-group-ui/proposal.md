# Proposal

## Why

Job groups (milestone 6) let a client submit many jobs at once and follow them as one group, but
today they are API only: a user of job-ui cannot see which groups exist or how a group's jobs are
doing. This change brings groups into job-ui with two pages, so groups can be followed the same way
single jobs are.

## What Changes

- A groups list page in job-ui, similar to the existing jobs list page.
- A group details page for each group, adapted from the user's design "Job Queue — UI"
  (`BatchJob`): the group's status, its progress with counts and one cell per child job, and its
  details (`ui.md`).
- The pages read groups from job-group-service's API (`GET /v1/groups`, `GET /v1/groups/:id`) and
  a group's jobs from job-service (`GET /v1/jobs?groupId=`),
  which comes with `job-group-service` and is not on the main branch yet; wiring the pages to that
  API is done once it is published.
- Roadmap milestone 6 ("API only, no UI") is updated to include this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `job-ui`: the groups list page and the group details page, their URLs and how they reach them
  from the app frame.

## Impact

- `apps/job-ui`: a new feature folder for groups (list and details pages, API calls, hooks),
  routes and app-frame navigation, locale strings.
- `packages/contracts`: uses the group schemas from `job-group-service`.
- Depends on `job-group-service` (and through it `job-bulk-create`) for the group API.
- Docs: `docs/roadmap/06-bulk-operations.md`, `README.md`.
