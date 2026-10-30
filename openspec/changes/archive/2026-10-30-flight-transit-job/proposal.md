# Proposal

## Why

Milestone 3 ("All job types") needs the aircraft transit report: a job that describes a flight
between two airports on a date and returns a generated report with the route, times and aircraft
details, later shown on a map. job-service today knows only the email and webhook types, so it
rejects transit submissions. This change teaches job-service the `flight-transit` type so clients
can submit, store and read transit jobs, and fixes the report shape the worker will return.
Generating the report (job-execution-service) and the map page are later changes.

## What Changes

- The shared job contract gains the `flight-transit` job type: its payload (origin and destination
  airport codes and a departure date, as in the design's Submit form) and the report a completed
  transit job returns (as on the design's Transit report page).
- A bundled static list of major airports is added to the shared contracts, so job-service can
  reject unknown codes on submit and the later worker and UI use the same airports.
- `POST /v1/jobs` accepts and validates transit jobs, including the rules that need more than the
  payload's shape: known airports, two different airports, and a departure day that is not over yet.
- `GET /v1/jobs/:id` and `GET /v1/jobs` return transit jobs alongside the other types.
- The internal API accepts a completed transit job's report, checked against the report schema.
- Postgres stores the new job type.
- The roadmap gains a `flight-transit-job-execution` change for generating the report.
- Out of scope: generating the report (job-execution-service), the submit form and the map page
  (job-ui), and the design fields of later milestones (idempotency key, run at, worker).

## Capabilities

### New Capabilities
- `flight-transit-job`: what an aircraft transit job is from a client's point of view: its payload,
  how a submission is validated (airport codes, departure date), and the report it returns.

### Modified Capabilities
None: job-ui only learns the new type's label, which no requirement covers.

## Impact

- `packages/contracts` (jobs/): transit payload and result schemas, the airport list, `JobType`,
  `Job`, `CreateJobRequest`, `JOB_RESULT_SCHEMAS`.
- `apps/job-service`: the departure-day check against its clock and the airport check on submit;
  Prisma `JobType` enum and a migration; OpenAPI docs pick up the new type from the contracts.
- `apps/job-execution-service`: no change; until `flight-transit-job-execution`, a queued transit
  job takes its existing "unsupported job type" path.
- `apps/job-ui`: the shared `JobType` grows, so it gets a type label and an empty Details cell for
  transit jobs, nothing more.
- `docs/roadmap/03-all-job-types.md`: new `flight-transit-job-execution` row.
