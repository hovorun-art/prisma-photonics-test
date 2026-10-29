import type { Job, JobError, JobStatus } from '@job-queue/contracts';

/**
 * Job storage, in the same five operations as `JobService`. `update` and `delete` are conditional:
 * they write only while the job is still in the expected state, so concurrent callers cannot both
 * win.
 */
export interface JobRepository {
  create(req: CreateJobRepositoryRequest): Promise<CreateJobRepositoryResponse>;
  /** Throws `JobNotFoundError` for an unknown id. */
  get(req: GetJobRepositoryRequest): Promise<GetJobRepositoryResponse>;
  /** Newest first (ties broken by id), with the number of all jobs. */
  query(req: QueryJobRepositoryRequest): Promise<QueryJobRepositoryResponse>;
  /**
   * Applies `changes` only while the job's status and attempts equal `expected`. Throws
   * `JobNotFoundError` for an unknown id, otherwise `JobStatusConflictError` with the current status.
   */
  update(req: UpdateJobRepositoryRequest): Promise<UpdateJobRepositoryResponse>;
  /**
   * Removes the job only while its status is one of `allowedStatuses`. Throws `JobNotFoundError`
   * for an unknown id, otherwise `JobStatusConflictError` with the current status.
   */
  delete(req: DeleteJobRepositoryRequest): Promise<DeleteJobRepositoryResponse>;
}

/** A job before it is stored: the id and the created/updated times are set by the database. */
export type NewJob = Job extends infer J
  ? J extends Job
    ? Omit<J, 'id' | 'createdAt' | 'updatedAt'>
    : never
  : never;

export interface CreateJobRepositoryRequest {
  job: NewJob;
}

export interface CreateJobRepositoryResponse {
  /** The stored job with its database-assigned id. */
  job: Job;
}

export interface GetJobRepositoryRequest {
  id: string;
}

export interface GetJobRepositoryResponse {
  job: Job;
}

export interface QueryJobRepositoryRequest {
  limit: number;
  offset: number;
}

export interface QueryJobRepositoryResponse {
  items: Job[];
  total: number;
}

/** The state an update was decided from. */
export interface ExpectedJobState {
  status: JobStatus;
  attempts: number;
}

/** The fields a lifecycle step changes; omitted fields stay as they are. `updatedAt` is set by storage. */
export interface JobChanges {
  status: JobStatus;
  attempts?: number;
  result?: unknown;
  error?: JobError | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface UpdateJobRepositoryRequest {
  id: string;
  expected: ExpectedJobState;
  changes: JobChanges;
}

export interface UpdateJobRepositoryResponse {
  job: Job;
}

export interface DeleteJobRepositoryRequest {
  id: string;
  allowedStatuses: readonly JobStatus[];
}

export type DeleteJobRepositoryResponse = Record<string, never>;

export const JOB_REPOSITORY = Symbol('JobRepository');
