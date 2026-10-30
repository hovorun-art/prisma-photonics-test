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

/**
 * job-group-service's public group routes as job-ui uses them. Every method throws `ApiError` when
 * the call fails: with the API's error code when job-group-service answered, without one otherwise.
 */
export interface GroupsApi {
  /** One page of groups, newest first, at job-group-service's default page size. */
  query(req: QueryGroupsApiRequest): Promise<QueryGroupsApiResponse>;
  get(req: GetGroupsApiRequest): Promise<GetGroupsApiResponse>;
}
