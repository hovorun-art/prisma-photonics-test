import type { Job, UpdateJobRequest } from '@job-queue/contracts';

/** job-service's internal job API, the only way job-execution-service reads or changes job state. */
export interface JobRepository {
  /**
   * Returns the job with its type's maximum processing time. Throws `JobNotFoundError` for a
   * deleted job, `InvalidJobError` when the answer does not match the contract,
   * `JobServiceUnavailableError` when job-service cannot be reached.
   */
  get(req: GetJobRepositoryRequest): Promise<GetJobRepositoryResponse>;
  /**
   * Reports a lifecycle step and returns the job as job-service sent it, not checked against the
   * contract (a corrupted payload is caught by `get`). Throws `JobNotFoundError`,
   * `JobStatusConflictError` with the job's current status when job-service refuses the step,
   * `JobServiceUnavailableError` when it cannot be reached.
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
  /** How long one attempt of the job may run, as configured in job-service for its type. */
  maxProcessingMs: number;
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
