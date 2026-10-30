import type {
  CreateJobRequest,
  Job,
  JobStatus,
  JobType,
  UpdateJobRequest,
} from '@job-queue/contracts';

/**
 * Everything job-service does with jobs: the five operations plus `createMany`, the bulk `create`. `update` holds the lifecycle rules
 * (start, completion, failure with retry or final failure); `delete` only removes finished jobs.
 */
export interface JobService {
  /**
   * Stores a new pending job and puts its first attempt on the queue. Throws
   * `InvalidJobPayloadError` for a flight transit whose departure day (UTC) is over.
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
  /** Only jobs of this group; jobs of every group and none when omitted. */
  groupId?: string | undefined;
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

export interface DeleteJobServiceRequest {
  id: string;
}

export type DeleteJobServiceResponse = Record<string, never>;

export const JOB_SERVICE = Symbol('JobService');
