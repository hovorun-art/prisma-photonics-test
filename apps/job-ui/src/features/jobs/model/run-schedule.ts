/** When a job runs: right after submission, or at the time the user entered. */
export type JobRun = 'now' | 'later';

/** Why an entered time can't be sent: missing, not after now, or further ahead than allowed. */
export type RunScheduleProblem = 'required' | 'past' | 'tooFar';

/** The form's run choice and the `datetime-local` text of its time (`YYYY-MM-DDTHH:mm`, local). */
export interface RunScheduleValues {
  readonly run: JobRun;
  readonly scheduledAt: string;
}

export type CheckRunScheduleRequest = RunScheduleValues;
export interface CheckRunScheduleResponse {
  readonly problem: RunScheduleProblem | null;
}
export type ToRequestRunScheduleRequest = RunScheduleValues;
export interface ToRequestRunScheduleResponse {
  /** The time as a UTC ISO timestamp; absent for "Immediately" or text that is not a time. */
  readonly scheduledAt: string | undefined;
}
export type MessageRunScheduleRequest = RunScheduleValues;
export interface MessageRunScheduleResponse {
  readonly message: string;
}
export interface TimeZoneRunScheduleResponse {
  /** The browser's IANA time zone, in which the time is entered. */
  readonly timeZone: string;
}

/**
 * The submit form's run choice: checks an entered time with the API's rules and turns it into the
 * request's `scheduledAt`. Shared by every job type's form.
 */
export interface RunSchedule {
  check(req: CheckRunScheduleRequest): CheckRunScheduleResponse;
  toRequest(req: ToRequestRunScheduleRequest): ToRequestRunScheduleResponse;
  /** job-ui's message for a rejected time. */
  message(req: MessageRunScheduleRequest): MessageRunScheduleResponse;
  timeZone(): TimeZoneRunScheduleResponse;
}
