import type { CreateJobRequest, ErrorCode, Job, QueryJobsResponse } from '@job-queue/contracts';

export interface QueryJobsApiRequest {
  readonly offset: number;
}
export type QueryJobsApiResponse = QueryJobsResponse;

export interface GetJobsApiRequest {
  readonly id: string;
}
export interface GetJobsApiResponse {
  readonly job: Job;
}

export interface CreateJobsApiRequest {
  readonly request: CreateJobRequest;
}
export interface CreateJobsApiResponse {
  readonly job: Job;
}

export interface DeleteJobsApiRequest {
  readonly id: string;
}
export interface DeleteJobsApiResponse {
  readonly id: string;
}

/**
 * job-service's public job routes as job-ui uses them. Every method throws `ApiError` when the
 * call fails: with the API's error code when job-service answered, without one otherwise.
 */
export interface JobsApi {
  query(req: QueryJobsApiRequest): Promise<QueryJobsApiResponse>;
  get(req: GetJobsApiRequest): Promise<GetJobsApiResponse>;
  create(req: CreateJobsApiRequest): Promise<CreateJobsApiResponse>;
  delete(req: DeleteJobsApiRequest): Promise<DeleteJobsApiResponse>;
}

/** A failed API call: the HTTP status and error body of job-service, or `null`s for a network failure. */
export interface ApiErrorShape {
  readonly status: number | null;
  readonly code: ErrorCode | null;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}
