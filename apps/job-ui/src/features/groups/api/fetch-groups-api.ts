import { JOB_GROUPS_ROUTE, JobGroup, QueryJobGroupsResponse } from '@job-queue/contracts';

import {
  FetchJsonApiClient,
  type FetchJsonApiClientParams,
} from '../../jobs/api/fetch-json-api-client';
import type {
  GetGroupsApiRequest,
  GetGroupsApiResponse,
  GroupsApi,
  QueryGroupsApiRequest,
  QueryGroupsApiResponse,
} from './groups-api';

export type FetchGroupsApiParams = FetchJsonApiClientParams;

/** `GroupsApi` over `fetch`; answers are parsed with the shared contract schemas. */
export class FetchGroupsApi implements GroupsApi {
  private readonly client: FetchJsonApiClient;

  constructor(p: FetchGroupsApiParams) {
    this.client = new FetchJsonApiClient(p);
  }

  async query(req: QueryGroupsApiRequest): Promise<QueryGroupsApiResponse> {
    const search = new URLSearchParams({ offset: String(req.offset) }).toString();
    const { response } = await this.client.send({
      path: `${JOB_GROUPS_ROUTE}?${search}`,
      init: { method: 'GET' },
    });
    return (await this.client.read({ schema: QueryJobGroupsResponse, response })).body;
  }

  async get(req: GetGroupsApiRequest): Promise<GetGroupsApiResponse> {
    const { response } = await this.client.send({
      path: `${JOB_GROUPS_ROUTE}/${encodeURIComponent(req.id)}`,
      init: { method: 'GET' },
    });
    return { group: (await this.client.read({ schema: JobGroup, response })).body };
  }
}
