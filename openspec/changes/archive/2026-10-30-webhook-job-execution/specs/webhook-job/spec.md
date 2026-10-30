# Spec Delta

## ADDED Requirements

### Requirement: A webhook job simulates the call
Running a webhook job SHALL NOT call the job's URL. It SHALL wait the configured call time and then
end as a success or a failure; each attempt fails at random with the configured failure rate.

#### Scenario: Webhook job takes the configured time
- **WHEN** a webhook job is run
- **THEN** it finishes only after the configured call time has passed

#### Scenario: Failure rate zero never fails
- **WHEN** webhook jobs are run with a configured failure rate of zero
- **THEN** every run succeeds

#### Scenario: Failure rate one always fails
- **WHEN** webhook jobs are run with a configured failure rate of one
- **THEN** every run fails

### Requirement: A successful webhook call returns an acknowledgement
A webhook run that succeeds SHALL return a result with `statusCode` 200 and a `responseBody` of
`received: true` and a `requestId` that is a new UUID for every run.

#### Scenario: Webhook job returns status 200 and a request id
- **WHEN** a webhook job is run and the call succeeds
- **THEN** the result has `statusCode` 200 and a `responseBody` with `received` true and a `requestId` that is a UUID, different for every run

### Requirement: A failed webhook call reports a server error status
A webhook run that fails SHALL fail the attempt with code `WEBHOOK_HTTP_ERROR`, a message naming the
method, the URL and the status, and `details.statusCode` set at random to one of 500, 502, 503 or
504. job-service then retries the job or fails it, as for any failed attempt.

#### Scenario: Failed webhook attempt carries a 5xx status
- **WHEN** a webhook job with method `POST` and URL `https://example.com/hook` is run and the call fails
- **THEN** the attempt fails with code `WEBHOOK_HTTP_ERROR`, `details.statusCode` one of 500, 502, 503 or 504, and the message `Webhook POST https://example.com/hook answered <status>` with that status

#### Scenario: Failed webhook attempt is logged as a warning
- **WHEN** a webhook job's call fails
- **THEN** a warning log line is written with the job id, the attempt, the instance id and the status code
