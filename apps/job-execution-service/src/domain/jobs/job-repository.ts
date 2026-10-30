import type { Job, UpdateJobRequest } from '@job-queue/contracts';

/** job-service's internal job API, the only way job-execution-service reads or changes job state. */
export interface JobRepository {
  /**
   * Throws `JobNotFoundError` for a deleted job, `InvalidJobError` when the job does not match the
   * contract, `JobServiceUnavailableError` when job-service cannot be reached.
   */
  get(req: GetJobRepositoryRequest): Promise<GetJobRepositoryResponse>;
  /**
   * Reports a lifecycle step and returns the job as job-service sent it, not checked against the
   * contract (a corrupted payload is caught by `get`). Throws `JobNotFoundError`, `JobStatusConflictError` when job-service
   * refuses the step, `JobServiceUnavailableError` when it cannot be reached.
   */
  update(req: UpdateJobRepositoryRequest): Promise<UpdateJobRepositoryResponse>;
}

export interface GetJobRepositoryRequest {
  id: string;
  /** Cancels the call (shutdown grace period over). */
  signal?: AbortSignal;
}

export interface GetJobRepositoryResponse {
  job: Job;
}

export interface UpdateJobRepositoryRequest {
  id: string;
  update: UpdateJobRequest;
  /** Cancels the call (shutdown grace period over). */
  signal?: AbortSignal;
}

export interface UpdateJobRepositoryResponse {
  job: Job;
}

export const JOB_REPOSITORY = Symbol('JobRepository');
