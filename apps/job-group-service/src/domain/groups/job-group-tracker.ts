/** Token for the poll that keeps open groups up to date. */
export const JOB_GROUP_TRACKER = Symbol('JobGroupTracker');

/**
 * Brings every open group's stats and status up to date with its child jobs in job-service. Open
 * groups are `running` and `failed` ones: retrying a failed child runs its group again.
 */
export interface JobGroupTracker {
  /**
   * Checks every open group once. A group whose check fails keeps its last state and is
   * counted in `failedChecks`; the other groups are still checked.
   */
  checkOpen(): Promise<CheckOpenJobGroupTrackerResponse>;
}

export interface CheckOpenJobGroupTrackerResponse {
  /** Groups whose check was recorded. */
  checked: number;
  /** Groups whose check failed (job-service unreachable or an unexpected answer). */
  failedChecks: number;
}
