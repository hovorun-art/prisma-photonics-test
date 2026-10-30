# Spec Delta

## ADDED Requirements

### Requirement: Users can choose the job type on the submit page
The "1. Job type" cards SHALL switch the form in place between Email and Webhook. Choosing Webhook
SHALL show `/jobs/new?type=webhook`, choosing Email `/jobs/new`; opening either URL directly SHALL
show that type selected, and Back SHALL return to the previous type. Switching SHALL keep Priority
and Max attempts and start the chosen type's payload fields empty.

#### Scenario: Choose Webhook
- **WHEN** a user on `/jobs/new` clicks the Webhook card
- **THEN** the Webhook card is selected, the payload section shows the webhook fields and the URL is `/jobs/new?type=webhook`

#### Scenario: Direct link to the webhook form
- **WHEN** a user opens `/jobs/new?type=webhook` directly
- **THEN** the Webhook card is selected and the webhook fields are shown

#### Scenario: Back to the previous type
- **WHEN** a user chooses Webhook on `/jobs/new` and presses the browser's Back button
- **THEN** the Email card is selected and the email fields are shown

#### Scenario: Switching keeps the execution settings
- **WHEN** a user changes Priority, types a subject, chooses Webhook and then Email again
- **THEN** Priority keeps the changed value and the email fields are empty

### Requirement: Users can submit a webhook job
With Webhook chosen, "2. Payload" SHALL show Method (POST, PUT, GET; POST at first), URL and "Body
(JSON)", empty at first, and the note "Mock target: some calls fail at random, so you can watch
retries.", matching the layout of the design's SubmitWebhook screen. Submitting a valid form SHALL
create a webhook job with the entered values and open its page; an empty body SHALL send no body.

#### Scenario: Submit a valid webhook job
- **WHEN** a user chooses Webhook, picks method PUT, enters an https URL and the body `{"orderId": "o-1"}` and clicks "Submit job"
- **THEN** a webhook job is created with method PUT, that URL and that body as a JSON object, and the new job's page opens

#### Scenario: Submit without a body
- **WHEN** a user chooses Webhook, enters a URL, leaves Body (JSON) empty and clicks "Submit job"
- **THEN** a webhook job is created whose payload has no body

#### Scenario: Webhook form at first
- **WHEN** a user opens `/jobs/new?type=webhook`
- **THEN** Method is POST, URL and Body (JSON) are empty, Priority and Max attempts hold the API's default values, and the mock target note is shown

### Requirement: The webhook form is validated before sending
The webhook form SHALL check its values with the same rules as the API before sending. A URL that
is empty, not an absolute http or https URL, or longer than the contract's limit, and a Body (JSON)
that is not valid JSON or not a JSON object, SHALL be shown in red with its error under the field,
and nothing SHALL be sent while a field is invalid.

#### Scenario: Invalid webhook URL
- **WHEN** a user enters the URL `ftp://example.com/hook` and clicks "Submit job"
- **THEN** the URL field shows an error under it and no request is sent

#### Scenario: Missing webhook URL
- **WHEN** a user leaves URL empty and clicks "Submit job"
- **THEN** the URL field shows an error under it and no request is sent

#### Scenario: Body is not valid JSON
- **WHEN** a user enters `{ orderId: ` as Body (JSON) and clicks "Submit job"
- **THEN** the Body (JSON) field shows an error under it and no request is sent

#### Scenario: Body is not a JSON object
- **WHEN** a user enters `[1, 2]` as Body (JSON) and clicks "Submit job"
- **THEN** the Body (JSON) field shows an error under it and no request is sent

#### Scenario: API validation error on a webhook field
- **WHEN** the API answers a webhook submit with `VALIDATION_FAILED` and an issue for `payload.url`
- **THEN** the URL field shows the issue's message and the entered values stay

### Requirement: The request preview follows the webhook form
With Webhook chosen, the request preview, its "Copy cURL" command and the example `201 Created`
response SHALL show the webhook request built from the form values, updated as the user types.

#### Scenario: Preview of a webhook request
- **WHEN** a user chooses Webhook and types a URL
- **THEN** the request preview shows type `webhook`, the chosen method and the typed URL in the request body

#### Scenario: Example response for a webhook job
- **WHEN** a user chooses Webhook
- **THEN** the Response box shows an example `201 Created` body with type `webhook` and status `pending`, marked as an example

### Requirement: The Details column summarises a webhook job
For a webhook job the Details column SHALL show the method and URL while the job waits or runs,
"HTTP <status code>" of the result when it is completed, and the error message when it has failed.

#### Scenario: Waiting or running webhook job
- **WHEN** the list shows a webhook job in status `scheduled`, `pending` or `processing`
- **THEN** its Details read "<METHOD> <url>"

#### Scenario: Completed webhook job
- **WHEN** the list shows a completed webhook job whose result has status code 200
- **THEN** its Details read "HTTP 200"

#### Scenario: Failed webhook job
- **WHEN** the list shows a failed webhook job
- **THEN** its Details show the job's error message

### Requirement: The job page shows a webhook job
The job page of a webhook job SHALL show the same layout as for any job: the webhook payload in the
Payload card, the result with its status code and response body in the Result card, and for a
failed job the error with its code, message and the HTTP status of the failed call in the Error card.

#### Scenario: Completed webhook job page
- **WHEN** a user opens the page of a completed webhook job
- **THEN** the page shows the webhook type badge, the payload's method, URL and body, and the result's status code and response body

#### Scenario: Failed webhook job page
- **WHEN** a user opens the page of a failed webhook job whose error has `details.statusCode` 503
- **THEN** the alert box shows the error message and the Error card shows the error's code, message and status code 503

## MODIFIED Requirements

### Requirement: Features not built yet are shown disabled
Design elements that need API features not built yet SHALL be shown muted and disabled, with a
"Coming soon" tooltip on hover and focus: the queue statistics cards (showing "—"), the "API
status —" pill, status and type filters, search, Cancel and Retry, the Aircraft transit job type,
the idempotency key and "At a specific time".

#### Scenario: Disabled filter
- **WHEN** a user hovers over or focuses a status filter on the jobs list
- **THEN** it is disabled and a "Coming soon" tooltip is shown

#### Scenario: Statistics without data
- **WHEN** a user opens the jobs list
- **THEN** the queue statistics cards show "—" instead of numbers and the header pill reads "API status —"

#### Scenario: Disabled job types
- **WHEN** a user opens the submit page
- **THEN** the Aircraft transit job type is disabled, the Webhook job type can be chosen and Email is selected
