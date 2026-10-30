import type {
  CreateJobRequest,
  ErrorCode,
  Job,
  JobStatus,
  JobType,
  QueryJobsResponse,
  QueueStats,
} from '@job-queue/contracts';

/** The list filters job-ui sends: at most one status and one type; left out means all. */
export interface JobListFilters {
  readonly status?: JobStatus;
  readonly type?: JobType;
}

export interface QueryJobsApiRequest extends JobListFilters {
  readonly offset: number;
  /** Only the jobs of this group. */
  readonly groupId?: string;
  /** Page size; left out means job-service's default. */
  readonly limit?: number;
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

export interface CreateBulkJobsApiRequest {
  readonly jobs: readonly CreateJobRequest[];
}
export interface CreateBulkJobsApiResponse {
  /** The created jobs, in the order of the request. */
  readonly jobs: readonly Job[];
}

export interface DeleteJobsApiRequest {
  readonly id: string;
}
export interface DeleteJobsApiResponse {
  readonly id: string;
}

export type StatsJobsApiRequest = JobListFilters;

export interface StatsJobsApiResponse {
  readonly stats: QueueStats;
}

/**
 * job-service's public job and statistics routes as job-ui uses them. Every method throws `ApiError` when the
 * call fails: with the API's error code when job-service answered, without one otherwise.
 */
export interface JobsApi {
  query(req: QueryJobsApiRequest): Promise<QueryJobsApiResponse>;
  get(req: GetJobsApiRequest): Promise<GetJobsApiResponse>;
  create(req: CreateJobsApiRequest): Promise<CreateJobsApiResponse>;
  /** Submits many jobs in one request (`POST /v1/jobs/bulk`), stored all or nothing. */
  createBulk(req: CreateBulkJobsApiRequest): Promise<CreateBulkJobsApiResponse>;
  delete(req: DeleteJobsApiRequest): Promise<DeleteJobsApiResponse>;
  /** The queue statistics (`GET /v1/stats`), with job counts faceted by the filters. */
  stats(req: StatsJobsApiRequest): Promise<StatsJobsApiResponse>;
}

/** A failed API call: the HTTP status and error body of job-service, or `null`s for a network failure. */
export interface ApiErrorShape {
  readonly status: number | null;
  readonly code: ErrorCode | null;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}
