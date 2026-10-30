import {
  Job,
  JOBS_ROUTE,
  QueryJobLogResponse,
  QueryJobsResponse,
  QueueStats,
  STATS_ROUTE,
} from '@job-queue/contracts';

import type { z } from 'zod';

import { FetchJsonApiClient, type FetchJsonApiClientParams } from './fetch-json-api-client';
import type {
  ChangeStatusJobsApiRequest,
  ChangeStatusJobsApiResponse,
  CreateJobsApiRequest,
  CreateJobsApiResponse,
  DeleteJobsApiRequest,
  DeleteJobsApiResponse,
  GetJobsApiRequest,
  GetJobsApiResponse,
  JobListFilters,
  JobsApi,
  LogsJobsApiRequest,
  LogsJobsApiResponse,
  QueryJobsApiRequest,
  QueryJobsApiResponse,
  StatsJobsApiRequest,
  StatsJobsApiResponse,
} from './jobs-api';

export type FetchJobsApiParams = FetchJsonApiClientParams;

/** `JobsApi` over `fetch`; answers are parsed with the shared contract schemas. */
export class FetchJobsApi implements JobsApi {
  private readonly client: FetchJsonApiClient;

  constructor(p: FetchJobsApiParams) {
    this.client = new FetchJsonApiClient(p);
  }

  async query(req: QueryJobsApiRequest): Promise<QueryJobsApiResponse> {
    const response = await this.send({
      path: `${JOBS_ROUTE}?${this.search({
        offset: String(req.offset),
        ...this.filters(req),
        ...(req.groupId === undefined ? {} : { groupId: req.groupId }),
        ...(req.limit === undefined ? {} : { limit: String(req.limit) }),
      })}`,
      init: { method: 'GET' },
    });
    return this.parse({ schema: QueryJobsResponse, response });
  }

  async get(req: GetJobsApiRequest): Promise<GetJobsApiResponse> {
    const response = await this.send({ path: this.jobPath(req.id), init: { method: 'GET' } });
    return { job: await this.parse({ schema: Job, response }) };
  }

  async create(req: CreateJobsApiRequest): Promise<CreateJobsApiResponse> {
    const response = await this.send({
      path: JOBS_ROUTE,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.request),
      },
    });
    return { job: await this.parse({ schema: Job, response }) };
  }

  async changeStatus(req: ChangeStatusJobsApiRequest): Promise<ChangeStatusJobsApiResponse> {
    const response = await this.send({
      path: this.jobPath(req.id),
      init: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: req.status }),
      },
    });
    return { job: await this.parse({ schema: Job, response }) };
  }

  async delete(req: DeleteJobsApiRequest): Promise<DeleteJobsApiResponse> {
    await this.send({ path: this.jobPath(req.id), init: { method: 'DELETE' } });
    return { id: req.id };
  }

  async logs(req: LogsJobsApiRequest): Promise<LogsJobsApiResponse> {
    const params = new URLSearchParams();
    if (req.after !== undefined) params.set('after', req.after);
    if (req.limit !== undefined) params.set('limit', String(req.limit));
    for (const level of req.level ?? []) params.append('level', level);
    const search = params.toString();
    const path = `${this.jobPath(req.id)}/logs`;
    const response = await this.send({
      path: search === '' ? path : `${path}?${search}`,
      init: { method: 'GET' },
    });
    return this.parse({ schema: QueryJobLogResponse, response });
  }

  async stats(req: StatsJobsApiRequest): Promise<StatsJobsApiResponse> {
    const search = this.search(this.filters(req));
    const response = await this.send({
      path: search === '' ? STATS_ROUTE : `${STATS_ROUTE}?${search}`,
      init: { method: 'GET' },
    });
    return { stats: await this.parse({ schema: QueueStats, response }) };
  }

  /** The filters that are set, as query parameters. */
  private filters(req: JobListFilters): Record<string, string> {
    return {
      ...(req.status === undefined ? {} : { status: req.status }),
      ...(req.type === undefined ? {} : { type: req.type }),
    };
  }

  private search(params: Record<string, string>): string {
    return new URLSearchParams(params).toString();
  }

  private jobPath(id: string): string {
    return `${JOBS_ROUTE}/${encodeURIComponent(id)}`;
  }

  private async send(req: { path: string; init: RequestInit }): Promise<Response> {
    return (await this.client.send(req)).response;
  }

  private async parse<T>(req: { schema: z.ZodType<T>; response: Response }): Promise<T> {
    return (await this.client.read(req)).body;
  }
}
