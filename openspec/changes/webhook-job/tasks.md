# Tasks

## Plan

1 (contracts) → 2 (job-service) → 3 (integration). Group 2 needs group 1's schemas, so none run in
parallel.

## 1. Webhook contract

Owns: `packages/contracts/src/jobs/job.ts`, `packages/contracts/src/jobs/job.test.ts` · Depends on: none · Parallel with: none

- [ ] 1.1 Write failing contract tests in `job.test.ts` named after the scenarios "Valid webhook job is accepted", "Webhook job without a body is accepted", "Method not allowed" (`DELETE` and `post`), "URL with another scheme", "URL missing or not a URL", "URL too long" (`WEBHOOK_LIMITS.urlMaxLength + 1`), "Body is not a JSON object" (array, string), each asserting the issue path; run `npm run test:unit -w packages/contracts` and see them fail because `webhook` is an unknown type
- [ ] 1.2 Write failing tests for `WebhookJobResult` ("Webhook result does not match": no `statusCode`, 404, 199, non-object `responseBody`; a 200 with an object body is accepted) and for `Job` parsing a webhook job with a failed error carrying `details.statusCode`
- [ ] 1.3 Add `WEBHOOK_METHODS`, `WEBHOOK_LIMITS`, `JsonObject`, `WebhookJobPayload`, `WebhookJobResult`, `WebhookJob`, `CreateWebhookJobRequest`; extend `JobType`, `Job`, `CreateJobRequest`, `JOB_RESULT_SCHEMAS` (design.md "Contract shapes"); verify the tests from 1.1 and 1.2 pass and `npm run build:packages` succeeds

## 2. job-service stores and serves webhook jobs

Owns: `apps/job-service/prisma/schema.prisma`, `apps/job-service/prisma/migrations/<timestamp>_webhook_job_type/`, `apps/job-service/src/infra/prisma/generated/**`, `apps/job-service/src/infra/jobs/prisma/prisma-job-repository.int.test.ts`, `apps/job-service/test/e2e/jobs.e2e.test.ts`, `apps/job-service/test/e2e/internal-jobs.e2e.test.ts`, `apps/job-service/test/e2e/docs.e2e.test.ts`, `apps/job-service/test/e2e/support/job-fixtures.ts` · Depends on: 1 · Parallel with: none

- [ ] 2.1 Write a failing repository integration test: a webhook job is created and read back with its payload (and without `body`); run `npm run test:integration -w apps/job-service` and see it fail on the missing enum value
- [ ] 2.2 Add `webhook` to the Prisma `JobType` enum, create the migration (`ALTER TYPE "job_type" ADD VALUE 'webhook'`) and regenerate the client; verify the test from 2.1 passes
- [ ] 2.3 Write per-app e2e tests in `jobs.e2e.test.ts` for "Valid webhook job is accepted", "Webhook job without a body is accepted", "Webhook job is read and listed like any job", and "Method not allowed" / "URL with another scheme" / "Body is not a JSON object" over HTTP (400 `VALIDATION_FAILED`, issue path, nothing stored); verify they pass
- [ ] 2.4 Give `JobFixtures.seed` an optional `type` (default `email`) that seeds a valid webhook payload; write e2e tests in `internal-jobs.e2e.test.ts` for "Webhook result is stored", "Webhook result does not match" and "Failed webhook error is returned with its status code"; verify they pass
- [ ] 2.5 Extend the docs e2e test so the OpenAPI document's submit body includes the `webhook` branch; verify `/docs` still builds with the recursive JSON body schema (fall back as in design.md "Risks" if not, and record it)

## 3. Integration

Owns: `DECISIONS.md` · Depends on: 1, 2 · Parallel with: none

- [ ] 3.1 Add a `DECISIONS.md` entry: webhook failures keep the shared `JobError` with `details.statusCode`, attempt and retryability derived from the job; webhook jobs queued before the handler exists fail as `UNSUPPORTED_JOB_TYPE`
- [ ] 3.2 Run the full checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`) and verify all pass

## Workflow follow-up

- Run the `change-verifier` subagent and get PASS, then `/archive webhook-job` on this branch.
