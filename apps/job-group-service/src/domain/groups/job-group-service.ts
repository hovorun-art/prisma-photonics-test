import type { JobGroup } from '@job-queue/contracts';

/** Token for the group use cases. */
export const JOB_GROUP_SERVICE = Symbol('JobGroupService');

/** What clients can do with job groups. Never submits, cancels or deletes jobs in job-service. */
export interface JobGroupService {
  /** Creates an empty running group. */
  create(): Promise<CreateJobGroupServiceResponse>;
  /** The group as last stored; `JobGroupNotFoundError` when no group has the id. */
  get(req: GetJobGroupServiceRequest): Promise<GetJobGroupServiceResponse>;
  /**
   * One page of groups, newest first; the configured default page size without `limit`, and the
   * page-limit error (`VALIDATION_FAILED`) above the configured maximum.
   */
  query(req: QueryJobGroupServiceRequest): Promise<QueryJobGroupServiceResponse>;
  /**
   * Deletes a group while job-service reports no job with its id: `JobGroupNotFoundError` for an
   * unknown group, `JobGroupNotEmptyError` when it has jobs, `JobServiceUnavailableError` when
   * job-service cannot be asked.
   */
  delete(req: DeleteJobGroupServiceRequest): Promise<DeleteJobGroupServiceResponse>;
}

export interface CreateJobGroupServiceResponse {
  group: JobGroup;
}

export interface GetJobGroupServiceRequest {
  id: string;
}

export interface GetJobGroupServiceResponse {
  group: JobGroup;
}

export interface QueryJobGroupServiceRequest {
  limit?: number;
  offset: number;
}

export interface QueryJobGroupServiceResponse {
  items: JobGroup[];
  total: number;
}

export interface DeleteJobGroupServiceRequest {
  id: string;
}

export type DeleteJobGroupServiceResponse = Record<string, never>;
