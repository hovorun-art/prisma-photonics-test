import type { JobGroup, JobGroupStatus } from '@job-queue/contracts';

/** Token for the store of job groups. */
export const JOB_GROUP_REPOSITORY = Symbol('JobGroupRepository');

/** Where job-group-service keeps its groups; only job-group-service reads and writes it. */
export interface JobGroupRepository {
  /** Stores a new running group with zero stats; its id comes from the store. */
  create(): Promise<CreateJobGroupRepositoryResponse>;
  /** The group with this id, or `null`. */
  get(req: GetJobGroupRepositoryRequest): Promise<GetJobGroupRepositoryResponse>;
  /** One page of groups, newest first, and the number of all groups. */
  query(req: QueryJobGroupRepositoryRequest): Promise<QueryJobGroupRepositoryResponse>;
  /** Removes the group; `deleted` is false when no group had the id. */
  delete(req: DeleteJobGroupRepositoryRequest): Promise<DeleteJobGroupRepositoryResponse>;
  /**
   * Up to `limit` open groups (`running` or `failed`: a failed child can still be retried) with an
   * id above `afterId` (all when omitted), ordered by id.
   */
  listOpen(req: ListOpenJobGroupRepositoryRequest): Promise<ListOpenJobGroupRepositoryResponse>;
  /**
   * Stores the result of one poll of an open group. `total` never decreases: the larger of the
   * stored and the given one is kept. A completed group, or one that no longer exists, is left as
   * it is and `recorded` is false.
   */
  recordCheck(
    req: RecordCheckJobGroupRepositoryRequest,
  ): Promise<RecordCheckJobGroupRepositoryResponse>;
}

export interface CreateJobGroupRepositoryResponse {
  group: JobGroup;
}

export interface GetJobGroupRepositoryRequest {
  id: string;
}

export interface GetJobGroupRepositoryResponse {
  group: JobGroup | null;
}

export interface QueryJobGroupRepositoryRequest {
  limit: number;
  offset: number;
}

export interface QueryJobGroupRepositoryResponse {
  items: JobGroup[];
  total: number;
}

export interface DeleteJobGroupRepositoryRequest {
  id: string;
}

export interface DeleteJobGroupRepositoryResponse {
  deleted: boolean;
}

export interface ListOpenJobGroupRepositoryRequest {
  limit: number;
  afterId?: string;
}

export interface ListOpenJobGroupRepositoryResponse {
  groups: JobGroup[];
}

export interface RecordCheckJobGroupRepositoryRequest {
  id: string;
  status: JobGroupStatus;
  total: number;
  completed: number;
  failed: number;
  /** ISO time of this poll. */
  checkedAt: string;
  /** ISO time the group finished; `null` while it still runs. */
  finishedAt: string | null;
}

export interface RecordCheckJobGroupRepositoryResponse {
  recorded: boolean;
}
