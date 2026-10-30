# Decisions: webhook-job-execution

## Decided

- The change is planned and built on its own branch `webhook-job-execution` (user)
- Scope: running webhook jobs in job-execution-service; added to roadmap milestone 3 (user)
- Carried over from `webhook-job`: the simulated call takes 1–2 s (now a fixed configured wait, see below) and fails 20% of the time to exercise retries; nothing is called for real; a completed job returns `{ statusCode, responseBody }` with a 2xx status and a JSON object body; a failed attempt reports code `WEBHOOK_HTTP_ERROR` with the HTTP status in `details.statusCode` (user)
- A successful simulated call returns `statusCode` 200 and `responseBody` `{ received: true, requestId: <uuid> }`, a fresh UUID per run through the kernel `Random` port (user)
- A simulated failure carries one of 500, 502, 503, 504 at random in `details.statusCode` (user)
- No new system e2e test in this change: the user is working on a new testing approach and will decide about tests after merging (user)
- "No new tests" covers only the system e2e: unit tests (TDD, one per spec scenario) as usual; no new system e2e or per-app e2e (user)
- New settings `WEBHOOK_FAILURE_RATE` and `WEBHOOK_CALL_MS` with defaults only in the config parser (user confirmed assumption; one wait setting instead of a min/max pair after the fixed wait was chosen)
- The simulated call waits a fixed configured time, 1500 ms by default, through the kernel `Sleeper` port; no random wait (user)
- Whether an attempt fails is drawn once per attempt, after the wait, through `Random.next()` against the configured failure rate (0.2 by default; 0 never fails, 1 always fails) (user)
- Each attempt's log lines carry the job id, attempt and instance id; a simulated failure is logged at warn level with its status code (user confirmed assumption)
- The `JobHandler` interface moves from `domain/notifications/` to `domain/execution/`; the webhook handler lives in `infra/webhooks/` (user confirmed assumption)
- The failure message reads "Webhook <METHOD> <url> answered <status>" (user confirmed assumption)

## Assumed

- [x] (rejected) The wait is a uniform random duration within the configured range (1000–2000 ms by default), through the kernel `Random` and `Sleeper` ports, like email - same pattern as email
- [x] (rejected) Whether an attempt fails is drawn once per attempt through `Random.next()` against the configured failure rate (0.2 by default, 0 never fails, 1 always fails); the draw comes after the wait, so failed calls also take time - deterministic tests, a real call fails after its latency
- [x] The failure rate and wait range are new settings (`WEBHOOK_FAILURE_RATE`, `WEBHOOK_CALL_MIN_MS`, `WEBHOOK_CALL_MAX_MS`) with defaults only in the config parser - same as the email wait range
- [x] The `JobHandler` interface moves from `domain/notifications/` to `domain/execution/`, since every domain module implements it; the webhook handler lives in `infra/webhooks/` - CLAUDE.md module layout
- [x] The failure message reads "Webhook <METHOD> <url> answered <status>" - readable on the job detail page
- [x] Each attempt's log lines carry the job id, attempt and instance id as today; a simulated failure is logged at warn level with its status code - existing logging rule

## Open questions

- [x] What status code and response body does a successful simulated call return?
- [x] What HTTP status does a simulated failure carry?
- [x] Should the system e2e on the full compose stack cover a webhook job, and how, given the random failures?
- [x] Does "no new tests" cover only the system e2e, or also unit, integration and per-app e2e tests for the webhook handler?
- [x] The default wait range of 1000–2000 ms and its uniform random draw were rejected: how should the wait work?
- [x] Drawing the failure once per attempt after the wait, at rate 0.2, was rejected: how should the failure be decided?
