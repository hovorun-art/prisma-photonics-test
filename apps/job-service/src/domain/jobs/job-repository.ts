import type { Job, JobError, JobStatus, JobType } from '@job-queue/contracts';

/**
 * Job storage, in the same five operations as `JobService`. `update` and `delete` are conditional:
 * they write only while the job is still in the expected state, so concurrent callers cannot both
 * win.
 */
export interface JobRepository {
  create(req: CreateJobRepositoryRequest): Promise<CreateJobRepositoryResponse>;
  /** Stores all jobs in one transaction, or none of them; returns them in the order given. */
  createMany(req: CreateManyJobRepositoryRequest): Promise<CreateManyJobRepositoryResponse>;
  /** Throws `JobNotFoundError` for an unknown id. */
  get(req: GetJobRepositoryRequest): Promise<GetJobRepositoryResponse>;
  /** Newest first (ties broken by id), with the number of jobs that match the filters. */
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

/**
 * A job before it is stored: the id and the updated time are set by the database, and so is the
 * created time unless given (a bulk spaces its jobs apart to keep their order). Without a group the
 * job's `groupId` is `null`.
 */
export type NewJob = Job extends infer J
  ? J extends Job
    ? Omit<J, 'id' | 'createdAt' | 'updatedAt' | 'groupId'> & {
        groupId?: string | null | undefined;
        createdAt?: string | undefined;
      }
    : never
  : never;

export interface CreateJobRepositoryRequest {
  job: NewJob;
}

export interface CreateJobRepositoryResponse {
  /** The stored job with its database-assigned id. */
  job: Job;
}

export interface CreateManyJobRepositoryRequest {
  jobs: NewJob[];
}

export interface CreateManyJobRepositoryResponse {
  /** The stored jobs with their database-assigned ids, in the order of the request. */
  jobs: Job[];
}

export interface GetJobRepositoryRequest {
  id: string;
}

export interface GetJobRepositoryResponse {
  job: Job;
  /** The job's run: 1, plus one per manual retry. Queue entries of the job carry it. */
  run: number;
}

export interface QueryJobRepositoryRequest {
  limit: number;
  offset: number;
  /** Only jobs in one of these statuses; every status when omitted. */
  statuses?: JobStatus[] | undefined;
  /** Only jobs of one of these types; every type when omitted. */
  types?: JobType[] | undefined;
  /** Only jobs of this group; jobs of every group and none when omitted. */
  groupId?: string | undefined;
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
  run?: number;
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
