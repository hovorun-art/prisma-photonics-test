import type {
  ChangeJobStatusRequest,
  CreateJobRequest,
  Job,
  JobStatus,
  JobType,
  UpdateJobRequest,
} from '@job-queue/contracts';

/**
 * Everything job-service does with jobs: the five operations plus `createMany`, the bulk `create`,
 * and `changeStatus`, a client's cancel or retry. `update` holds the worker's lifecycle rules
 * (start, completion, failure with retry or final failure); `delete` only removes finished jobs.
 */
export interface JobService {
  /**
   * Stores a new job, `scheduled` when its `scheduledAt` is in the future and `pending` otherwise,
   * and puts its first attempt on the queue with the job's priority, not handed out before its
   * `scheduledAt`. Throws `InvalidJobPayloadError` for a flight transit whose departure day (UTC) is
   * over, or `InvalidJobFieldError` listing every broken rule when the `scheduledAt` is more than the
   * contract's maximum ahead.
   */
  create(req: CreateJobServiceRequest): Promise<CreateJobServiceResponse>;
  /**
   * Stores all jobs as `create` would, all or none, and puts their first attempts on the queue in
   * one call. Throws `BulkLimitExceededError` above the configured maximum number of jobs, or
   * `InvalidJobFieldError` with each failing item's position when any item breaks a rule of `create`.
   */
  createMany(req: CreateManyJobServiceRequest): Promise<CreateManyJobServiceResponse>;
  /** Throws `JobNotFoundError` for an unknown id. */
  get(req: GetJobServiceRequest): Promise<GetJobServiceResponse>;
  /** Throws `QueryLimitExceededError` above the configured maximum page size. */
  query(req: QueryJobServiceRequest): Promise<QueryJobServiceResponse>;
  /** Throws `JobNotFoundError`, `JobStatusConflictError`, or `InvalidJobResultError` for a result that does not match the job type. */
  update(req: UpdateJobServiceRequest): Promise<UpdateJobServiceResponse>;
  /**
   * Cancels a job that has not finished (and tells the worker running it to stop), or retries a
   * failed job: back to pending from its first attempt, queued again. Throws `JobNotFoundError`, or
   * `JobStatusConflictError` when the job's status does not allow the change.
   */
  changeStatus(req: ChangeStatusJobServiceRequest): Promise<ChangeStatusJobServiceResponse>;
  /** Throws `JobNotFoundError`, or `JobStatusConflictError` for a job that has not finished. */
  delete(req: DeleteJobServiceRequest): Promise<DeleteJobServiceResponse>;
}

export interface CreateJobServiceRequest {
  job: CreateJobRequest;
}

export interface CreateJobServiceResponse {
  job: Job;
}

export interface CreateManyJobServiceRequest {
  jobs: CreateJobRequest[];
}

export interface CreateManyJobServiceResponse {
  /** The stored jobs in the order of the request. */
  jobs: Job[];
}

export interface GetJobServiceRequest {
  id: string;
}

export interface GetJobServiceResponse {
  job: Job;
}

export interface QueryJobServiceRequest {
  /** The configured default page size when omitted. */
  limit?: number | undefined;
  offset: number;
  /** Only jobs in one of these statuses; every status when omitted. */
  statuses?: JobStatus[] | undefined;
  /** Only jobs of one of these types; every type when omitted. */
  types?: JobType[] | undefined;
  /** Only jobs of this group, or (`null`) only jobs without one; every job when omitted. */
  groupId?: string | null | undefined;
}

export interface QueryJobServiceResponse {
  items: Job[];
  total: number;
}

export interface UpdateJobServiceRequest {
  id: string;
  update: UpdateJobRequest;
}

export interface UpdateJobServiceResponse {
  job: Job;
}

export interface ChangeStatusJobServiceRequest {
  id: string;
  change: ChangeJobStatusRequest;
}

export interface ChangeStatusJobServiceResponse {
  job: Job;
}

export interface DeleteJobServiceRequest {
  id: string;
}

export type DeleteJobServiceResponse = Record<string, never>;

export const JOB_SERVICE = Symbol('JobService');
