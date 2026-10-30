# webhook-job Specification

## Purpose

Defines the webhook job type from a client's point of view: the call it describes (method, URL,
JSON body), how a submission is validated, and the result and error a webhook job reports.

## Requirements

### Requirement: Clients can submit a webhook job
`POST /v1/jobs` with type `webhook`, a webhook payload (`method`, `url` and an optional JSON object
`body`) and optionally a priority and max attempts SHALL store a new job and answer HTTP 201 with
the job, as described for any job in job-management.

#### Scenario: Valid webhook job is accepted
- **WHEN** a client submits a job with type `webhook`, method `POST`, an https URL and a JSON object body
- **THEN** the response has HTTP status 201 and the job with type `webhook`, a UUID id, status `pending`, zero attempts, the given payload, and `null` result and error

#### Scenario: Webhook job without a body is accepted
- **WHEN** a client submits a webhook job with method `GET`, an http URL and no `body`
- **THEN** the response has HTTP status 201 and the job's payload has no `body`

#### Scenario: Webhook job is read and listed like any job
- **WHEN** a client submits a webhook job and then gets it by the returned id and lists jobs
- **THEN** the get response is the same job, and the list contains it with type `webhook` next to email jobs

### Requirement: Invalid webhook payloads are rejected
A webhook submission whose `method` is not one of `POST`, `PUT`, `GET` (upper case), whose `url` is
missing, not an absolute http or https URL, or longer than the contract's limit, or whose `body` is
present but not a JSON object SHALL be answered with HTTP 400 and `VALIDATION_FAILED`, with an issue
for that field, and SHALL store nothing.

#### Scenario: Method not allowed
- **WHEN** a client submits a webhook job whose `method` is `DELETE` or `post`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.method` field, and no job is stored

#### Scenario: URL with another scheme
- **WHEN** a client submits a webhook job whose `url` is `ftp://example.com/hook`
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.url` field

#### Scenario: URL missing or not a URL
- **WHEN** a client submits a webhook job without a `url`, or with a `url` that is not an absolute URL
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.url` field

#### Scenario: URL too long
- **WHEN** a client submits a webhook job whose `url` is longer than the contract's limit
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.url` field

#### Scenario: Body is not a JSON object
- **WHEN** a client submits a webhook job whose `body` is an array or a string
- **THEN** the response has HTTP status 400, the code `VALIDATION_FAILED` and an issue for the `payload.body` field

### Requirement: A completed webhook job stores its response
A `completed` report for a webhook job SHALL carry a result with `statusCode`, a 2xx HTTP status,
and `responseBody`, a JSON object; job-service SHALL store it and return it as the job's result. A
result that does not match SHALL be answered with HTTP 400 and `VALIDATION_FAILED` and leave the job
unchanged.

#### Scenario: Webhook result is stored
- **WHEN** job-execution-service reports a `processing` webhook job `completed` with status code 200 and a JSON object response body
- **THEN** the response has HTTP status 200 and the job in status `completed` with that result, and getting the job returns the same result

#### Scenario: Webhook result does not match
- **WHEN** job-execution-service reports a webhook job `completed` with a result that has no `statusCode`, or a status code outside 2xx, or a response body that is not a JSON object
- **THEN** the response has HTTP status 400 and the code `VALIDATION_FAILED`, and the job is unchanged

### Requirement: A failed webhook attempt keeps its HTTP status
A `failed` report for a webhook job SHALL be stored as the job's error as sent, so the HTTP status
of the failed call in `details.statusCode` stays visible to clients; how many attempts were made and
whether another follows come from the job's attempts and max attempts.

#### Scenario: Failed webhook error is returned with its status code
- **WHEN** job-execution-service reports a `processing` webhook job on its last attempt `failed` with code `WEBHOOK_HTTP_ERROR`, a message and `details.statusCode` 503
- **THEN** getting the job returns status `failed`, attempts equal to max attempts, and an error with code `WEBHOOK_HTTP_ERROR`, that message and `details.statusCode` 503
