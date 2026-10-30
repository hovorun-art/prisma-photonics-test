export interface CheckScheduleLimitRequest {
  /** The instant a job is asked to run at. */
  scheduledAt: Date;
}
export interface CheckScheduleLimitResponse {
  /** The clock's time the check was made at. */
  now: Date;
  /** The latest instant a job may be scheduled for; exactly this instant is allowed. */
  latest: Date;
  /** Whether `scheduledAt` is after `latest`. */
  tooFar: boolean;
}

/**
 * The rule for how far ahead a job may be scheduled: at most the configured number of days after
 * now. Shared by job-service, which enforces it, and job-ui, which checks it before sending.
 */
export interface ScheduleLimit {
  check(req: CheckScheduleLimitRequest): CheckScheduleLimitResponse;
}
