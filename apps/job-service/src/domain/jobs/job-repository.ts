import type { Job, JobError, JobStatus, JobType } from '@job-queue/contracts';

/**
 * Job storage, in the same five operations as `JobService`. `update` and `delete` are conditional:
 * they write only while the job is still in the expected state, so concurrent callers cannot both
 * win.
 */
export interface JobRepository {
  /** Throws `IdempotencyKeyTakenError` when another job already holds the job's idempotency key. */
  create(req: CreateJobRepositoryRequest): Promise<CreateJobRepositoryResponse>;
  /**
   * Stores all jobs in one transaction, or none of them; returns them in the order given. Throws
   * `IdempotencyKeyTakenError` (nothing stored) when another job already holds one of their keys.
   */
  createMany(req: CreateManyJobRepositoryRequest): Promise<CreateManyJobRepositoryResponse>;
  /** Throws `JobNotFoundError` for an unknown id. */
  get(req: GetJobRepositoryRequest): Promise<GetJobRepositoryResponse>;
  /** The jobs holding any of the keys, with the fingerprint of the request each was submitted with. */
  findByIdempotencyKeys(
    req: FindByIdempotencyKeysJobRepositoryRequest,
  ): Promise<FindByIdempotencyKeysJobRepositoryResponse>;
  /**
   * Jobs waiting to be started that have been in their state since `before` or longer: `pending`
   * jobs, and `scheduled` jobs whose `scheduledAt` is not after `before`. Oldest change first, at
   * most `limit`.
   */
  findWaitingSince(req: FindSinceJobRepositoryRequest): Promise<FindSinceJobRepositoryResponse>;
  /** `processing` jobs that have been in that state since `before` or longer, oldest change first, at most `limit`. */
  findProcessingSince(req: FindSinceJobRepositoryRequest): Promise<FindSinceJobRepositoryResponse>;
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
 * job's `groupId` is `null`; without a key its `idempotencyKey` and `requestFingerprint` are `null`.
 */
export type NewJob = Job extends infer J
  ? J extends Job
    ? Omit<J, 'id' | 'createdAt' | 'updatedAt' | 'groupId' | 'idempotencyKey'> & {
        groupId?: string | null | undefined;
        idempotencyKey?: string | null | undefined;
        /** The fingerprint of the request a keyed job was submitted with (`JobRequestFingerprint`). */
        requestFingerprint?: string | null | undefined;
        createdAt?: string | undefined;
      }
    : never
  : never;

/** A stored job with what only job-service sees: its run and the fingerprint of its request. */
export interface StoredJob {
  job: Job;
  /** The job's run: 1, plus one per manual retry. Queue entries of the job carry it. */
  run: number;
  /** The fingerprint of the request the job was submitted with; `null` for a job without a key. */
  requestFingerprint: string | null;
}

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

export type GetJobRepositoryResponse = StoredJob;

export interface FindByIdempotencyKeysJobRepositoryRequest {
  keys: readonly string[];
}

export interface FindByIdempotencyKeysJobRepositoryResponse {
  /** One per key that a job holds, in no particular order. */
  jobs: StoredJob[];
}

export interface FindSinceJobRepositoryRequest {
  /** Only jobs whose last change is not after this instant. */
  before: Date;
  limit: number;
}

export interface FindSinceJobRepositoryResponse {
  jobs: StoredJob[];
}

export interface QueryJobRepositoryRequest {
  limit: number;
  offset: number;
  /** Only jobs in one of these statuses; every status when omitted. */
  statuses?: JobStatus[] | undefined;
  /** Only jobs of one of these types; every type when omitted. */
  types?: JobType[] | undefined;
  /** Only jobs of this group, or (`null`) only jobs without one; every job when omitted. */
  groupId?: string | null | undefined;
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
  scheduledAt?: string | null;
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
