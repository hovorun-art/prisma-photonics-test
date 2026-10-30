# Decisions: priority-scheduling-ui

## Decided

- The change covers "At a specific time" on the submit page (date and time in local time) and the scheduled time on the jobs list and the job page. (user, roadmap `docs/roadmap/05-reliability.md`)
- The time is entered with a native `<input type="datetime-local">` styled like the other inputs; no new dependency. (user)
- On the jobs list, a `scheduled` job's Status cell shows the local run time under the status badge; other rows and the columns are unchanged. (user)
- The job page's Lifecycle shows a first "Scheduled" step (at the creation time) for jobs with a `scheduledAt`, before pending, processing and the final status; jobs without one keep today's steps. (user)
- For such a job the "Scheduled" step replaces "Pending": Scheduled (creation time) -> Processing -> final, since the API moves it `scheduled` -> `processing` directly. A job counts as such when its `scheduledAt` is after its creation time (a past `scheduledAt` makes the API create it `pending`, so it keeps today's steps). (user)
- A chosen time that is now or in the past is rejected in the form with "Choose a time in the future" and nothing is sent; "Immediately" is the way to run now. (user)
- "Immediately" stays selected when the submit page opens and sends no `scheduledAt`; choosing "At a specific time" shows the date and time input under the choice. (user confirmed assumption)
- The time is entered in the browser's local time zone and sent as an ISO 8601 UTC timestamp (`...Z`); a hint under the input names the local time zone. (user confirmed assumption)
- A time more than the contract's `JOB_LIMITS.scheduledAt.maxAheadDays` ahead is rejected in the form with "Choose a time within <n> days", like the API. (user confirmed assumption)
- Leaving the time empty with "At a specific time" chosen is rejected with "Choose a date and time". (user confirmed assumption)
- Switching the job type keeps the run choice and the time, like Priority and Max attempts. (user confirmed assumption)
- The request preview and the cURL show `scheduledAt` when a time is chosen; the example response then shows status `scheduled` and `scheduledAt`. (user confirmed assumption)
- An API `VALIDATION_FAILED` issue on `scheduledAt` is shown under the time input. (user confirmed assumption)
- On the job page, the Details list gains a "Scheduled for" row with the local date and time, shown only when the job has a `scheduledAt`. (user confirmed assumption)
- The scheduled time uses the same local date and time format as Created, Started and Finished. (user confirmed assumption)
- "At a specific time" is removed from the "Features still to come" list; the idempotency key stays disabled. (user confirmed assumption)

## Assumed

- [x] "Immediately" stays selected when the submit page opens and sends no `scheduledAt`; choosing "At a specific time" shows the date and time input under the choice - today's default, so nothing changes for users who don't schedule.
- [x] The time is entered in the browser's local time zone and sent as an ISO 8601 UTC timestamp (`...Z`); a hint under the input names the local time zone - the API accepts any offset, UTC keeps the preview readable.
- [x] A time more than the contract's `JOB_LIMITS.scheduledAt.maxAheadDays` ahead is rejected in the form with "Choose a time within <n> days", like the API - the form uses the API's rules today.
- [x] Leaving the time empty with "At a specific time" chosen is rejected with "Choose a date and time" - an empty schedule has no meaning.
- [x] Switching the job type keeps the run choice and the time, like Priority and Max attempts - they are execution settings.
- [x] The request preview and the cURL show `scheduledAt` when a time is chosen; the example response then shows status `scheduled` and `scheduledAt` - the preview mirrors the request today.
- [x] An API `VALIDATION_FAILED` issue on `scheduledAt` is shown under the time input - the same rule as other fields.
- [x] On the job page, the Details list gains a "Scheduled for" row with the local date and time, shown only when the job has a `scheduledAt` - jobs without one have nothing to show.
- [x] The scheduled time uses the same local date and time format as Created, Started and Finished - one format on the page.
- [x] "At a specific time" is removed from the "Features still to come" list; the idempotency key stays disabled - only scheduling is built here.

## Open questions

- [x] Which date and time input does the form use (native `datetime-local` vs a shadcn calendar picker)?
- [x] How does the jobs list show when a scheduled job will run?
- [x] Does the job page's Lifecycle show a `scheduled` step?
- [x] What does the form do with a time in the past (or now)?
- [x] Does the Lifecycle of a scheduled job also show a Pending step?
