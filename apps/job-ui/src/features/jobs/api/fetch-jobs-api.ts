import {
  ErrorBody,
  Job,
  JOBS_ROUTE,
  QueryJobsResponse,
  QueueStats,
  STATS_ROUTE,
} from '@job-queue/contracts';
import type { z } from 'zod';

import { ApiError } from './api-error';
import type {
  CreateJobsApiRequest,
  CreateJobsApiResponse,
  DeleteJobsApiRequest,
  DeleteJobsApiResponse,
  GetJobsApiRequest,
  GetJobsApiResponse,
  JobsApi,
  QueryJobsApiRequest,
  QueryJobsApiResponse,
  StatsJobsApiResponse,
} from './jobs-api';

export interface FetchJobsApiParams {
  /** Absolute URL of the API root as the browser reaches it, e.g. `http://host/api`. */
  readonly baseUrl: string;
  /** Message of an `ApiError` when job-service could not be reached or answered without an error body. */
  readonly networkErrorMessage: string;
}

/** `JobsApi` over `fetch`; answers are parsed with the shared contract schemas. */
export class FetchJobsApi implements JobsApi {
  constructor(private readonly p: FetchJobsApiParams) {}

  async query(req: QueryJobsApiRequest): Promise<QueryJobsApiResponse> {
    const response = await this.send({
      path: `${JOBS_ROUTE}?offset=${req.offset}`,
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

  async delete(req: DeleteJobsApiRequest): Promise<DeleteJobsApiResponse> {
    await this.send({ path: this.jobPath(req.id), init: { method: 'DELETE' } });
    return { id: req.id };
  }

  async stats(): Promise<StatsJobsApiResponse> {
    const response = await this.send({ path: STATS_ROUTE, init: { method: 'GET' } });
    return { stats: await this.parse({ schema: QueueStats, response }) };
  }

  private jobPath(id: string): string {
    return `${JOBS_ROUTE}/${encodeURIComponent(id)}`;
  }

  private async send(req: { path: string; init: RequestInit }): Promise<Response> {
    const headers = new Headers(req.init.headers);
    headers.set('Accept', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${this.p.baseUrl}${req.path}`, { ...req.init, headers });
    } catch {
      throw this.networkError(null);
    }
    if (!response.ok) throw await this.errorOf(response);
    return response;
  }

  private async errorOf(response: Response): Promise<ApiError> {
    const body = ErrorBody.safeParse(await response.json().catch(() => null));
    if (!body.success) return this.networkError(response.status);
    return new ApiError({ status: response.status, ...body.data });
  }

  private async parse<T>(req: { schema: z.ZodType<T>; response: Response }): Promise<T> {
    const body = req.schema.safeParse(await req.response.json().catch(() => null));
    if (!body.success) throw this.networkError(req.response.status);
    return body.data;
  }

  private networkError(status: number | null): ApiError {
    return new ApiError({ status, code: null, message: this.p.networkErrorMessage });
  }
}
