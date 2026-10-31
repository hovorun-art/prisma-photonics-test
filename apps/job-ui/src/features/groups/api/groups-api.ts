import type { JobGroup, QueryJobGroupsResponse } from '@job-queue/contracts';

export interface QueryGroupsApiRequest {
  readonly offset: number;
}
export type QueryGroupsApiResponse = QueryJobGroupsResponse;

export interface GetGroupsApiRequest {
  readonly id: string;
}
export interface GetGroupsApiResponse {
  readonly group: JobGroup;
}

export interface CreateGroupsApiResponse {
  readonly group: JobGroup;
}

export interface DeleteGroupsApiRequest {
  readonly id: string;
}
export interface DeleteGroupsApiResponse {
  readonly id: string;
}

/**
 * job-group-service's public group routes as job-ui uses them. Every method throws `ApiError` when
 * the call fails: with the API's error code when job-group-service answered, without one otherwise.
 */
export interface GroupsApi {
  /** One page of groups, newest first, at job-group-service's default page size. */
  query(req: QueryGroupsApiRequest): Promise<QueryGroupsApiResponse>;
  get(req: GetGroupsApiRequest): Promise<GetGroupsApiResponse>;
  /** Creates an empty group. */
  create(): Promise<CreateGroupsApiResponse>;
  /** Deletes a group; job-group-service refuses while job-service has a job with its id. */
  delete(req: DeleteGroupsApiRequest): Promise<DeleteGroupsApiResponse>;
}
