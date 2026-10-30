/** Token for the poll that keeps running groups up to date. */
export const JOB_GROUP_TRACKER = Symbol('JobGroupTracker');

/** Brings every running group's stats and status up to date with its child jobs in job-service. */
export interface JobGroupTracker {
  /**
   * Checks every running group once. A group whose check fails keeps its last state and is
   * counted in `failedChecks`; the other groups are still checked.
   */
  checkRunning(): Promise<CheckRunningJobGroupTrackerResponse>;
}

export interface CheckRunningJobGroupTrackerResponse {
  /** Groups whose check was recorded. */
  checked: number;
  /** Groups whose check failed (job-service unreachable or an unexpected answer). */
  failedChecks: number;
}
