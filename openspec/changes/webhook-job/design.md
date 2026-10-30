# Design

## Context

job-service is already type-generic: `CreateJobRequest`, `Job` and `JOB_RESULT_SCHEMAS` in
`packages/contracts/src/jobs/job.ts` drive validation (nestjs-zod DTOs), OpenAPI, result checks in
`JobServiceImpl` and row mapping in `PrismaJobRepository.toJob` (`Job.parse`). The type is stored
in the Postgres enum `job_type`, which today holds only `email`. So adding a type means
changing the contract and the enum; no job-service class needs new logic.

## Goals / Non-Goals

**Goals:**
- Webhook schemas in the shared contract, reused by job-service now and by job-execution-service
  and job-ui later.
- Tests at every level that already covers email: contract unit tests, repository integration
  test, per-app e2e for the public and internal routes.

**Non-Goals:**
- A webhook handler in job-execution-service. Until it exists, a queued webhook job is read by the
  worker, which finds no handler and reports `UNSUPPORTED_JOB_TYPE` (existing behaviour), so the
  job fails after its attempts. Accepted for this change.
- Design fields from later milestones (idempotency key, run at, last worker) and the email field
  naming in the design (`title` vs `subject`).

## Decisions

**Contract shapes** (`packages/contracts/src/jobs/job.ts`):
- `WEBHOOK_LIMITS = { urlMaxLength: 2048 }` and `WEBHOOK_METHODS = ['POST', 'PUT', 'GET']`, exported
  next to `EMAIL_LIMITS` so job-ui's form uses the same values.
- `WebhookJobPayload = z.object({ method: z.enum(WEBHOOK_METHODS), url, body: JsonObject.optional() })`
  where `url` is `z.url({ protocol: /^https?$/ }).max(urlMaxLength)`. Zod 4's `z.url()` with
  `protocol` rejects other schemes and non-absolute strings in one check, and the issue path is
  `payload.url`.
- `JsonObject = z.record(z.string(), z.json())`: an object with any JSON values. Alternative
  `z.looseObject({})` was rejected because it would accept non-JSON values in the type and say
  nothing in OpenAPI about the values.
- `WebhookJobResult = z.object({ statusCode: z.number().int().min(200).max(299), responseBody: JsonObject })`.
- `JobType` becomes `z.enum(['email', 'webhook'])`; `WebhookJob` extends `JobBase` with
  `type: 'webhook'`; `Job`, `CreateJobRequest` and `JOB_RESULT_SCHEMAS` gain the webhook branch.
- `JobError` is unchanged (`details.statusCode` is free-form `details`). Alternative: a typed error
  per job type. Rejected by the user to keep one error shape for all types.

**Database**: one Prisma migration `ALTER TYPE "job_type" ADD VALUE 'webhook'` plus
`enum JobType { email webhook }` in `schema.prisma`, then `prisma generate`. Alternative: turn the
column into text with a check. Rejected: the enum is already in place and adding a value is
cheap and non-blocking in Postgres.

**Test fixtures**: the e2e `JobFixtures.seed` gains an optional `type` (default `email`) and seeds a
valid webhook payload for `webhook`, so internal-route tests can start from a `processing` webhook
job.

**Module boundaries for the tasks**: group 1 owns the contracts; group 2 owns job-service (Prisma
schema, migration, generated client, tests, fixtures). Group 2 depends on group 1.

## Risks / Trade-offs

- [`z.json()` is recursive and may render poorly in the generated OpenAPI] → the docs e2e test
  already renders the document; check that `/docs` still builds and shows the webhook branch. If
  nestjs-zod cannot render it, fall back to `z.record(z.string(), z.unknown())` and record it.
- [Webhook jobs queued before their handler exists end as `failed` with `UNSUPPORTED_JOB_TYPE`] →
  out of scope by decision; the next change adds the handler.
- [`ALTER TYPE ... ADD VALUE` cannot be rolled back by a down migration] → Prisma has no down
  migrations here; rollback would be a new migration. The value is harmless if unused.

## Migration Plan

`migrate` (compose one-shot) applies the new migration before job-service starts; existing rows are
untouched.
