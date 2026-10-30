/** Token for the reader of a group's child jobs in job-service. */
export const GROUP_CHILD_JOBS = Symbol('GroupChildJobs');

/**
 * The jobs in job-service that carry a group's id, as counts. Throws the kernel's
 * `JobServiceUnavailableError` when job-service cannot be reached, times out or answers with a 5xx.
 */
export interface GroupChildJobs {
  count(req: CountGroupChildJobsRequest): Promise<CountGroupChildJobsResponse>;
}

export interface CountGroupChildJobsRequest {
  groupId: string;
}

export interface CountGroupChildJobsResponse {
  /** All jobs with the group's id, whatever their status; never below `completed + failed`. */
  total: number;
  /** Jobs in status `completed`. */
  completed: number;
  /** Jobs in status `failed` or `cancelled`. */
  failed: number;
}
