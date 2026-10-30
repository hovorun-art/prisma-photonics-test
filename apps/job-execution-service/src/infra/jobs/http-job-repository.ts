import {
  INTERNAL_JOBS_ROUTE,
  InternalJob,
  type Job,
  SERVICE_TOKEN_SCHEME,
  type UpdateJobRequest,
} from '@job-queue/contracts';

import {
  InvalidJobError,
  type InvalidJobIssue,
} from '../../domain/jobs/errors/invalid-job.error.js';
import { JobNotFoundError, type JobServiceHttp, JobStatusConflictError } from '@job-queue/kernel';
import type {
  GetJobRepositoryRequest,
  GetJobRepositoryResponse,
  JobRepository,
  UpdateJobRepositoryRequest,
  UpdateJobRepositoryResponse,
} from '../../domain/jobs/job-repository.js';

export interface HttpJobRepositoryDeps {
  /** job-service; it throws `JobServiceUnavailableError` for an outage. */
  http: JobServiceHttp;
}

export interface HttpJobRepositoryParams {
  serviceToken: string;
}

interface CallRequest {
  id: string;
  method: 'GET' | 'PATCH';
  body?: UpdateJobRequest;
  signal?: AbortSignal | undefined;
}

/**
 * job-service's internal job API over HTTP. A read is validated with the shared `InternalJob` schema
 * (the job with its maximum processing time); the job in the answer to an accepted report is passed
 * through unchecked, since the step already took effect and a corrupted payload must not hide that
 * (it is reported once it is read).
 * An unavailable job-service (network error, timeout, 5xx) surfaces as `JobServiceUnavailableError`
 * (the only retryable error); 404 and 409 map to their own errors; any other refusal is an
 * `InvalidJobError`.
 */
export class HttpJobRepository implements JobRepository {
  constructor(
    private readonly d: HttpJobRepositoryDeps,
    private readonly p: HttpJobRepositoryParams,
  ) {}

  async get(req: GetJobRepositoryRequest): Promise<GetJobRepositoryResponse> {
    const body = await this.call({ id: req.id, method: 'GET', signal: req.signal });
    const parsed = InternalJob.safeParse(body);
    if (!parsed.success) throw new InvalidJobError({ id: req.id, issues: parsed.error.issues });
    const { maxProcessingMs, ...job } = parsed.data;
    return { job, maxProcessingMs };
  }

  async update(req: UpdateJobRepositoryRequest): Promise<UpdateJobRepositoryResponse> {
    const body = await this.call({
      id: req.id,
      method: 'PATCH',
      body: req.update,
      signal: req.signal,
    });
    return { job: body as Job };
  }

  /** Sends one request and returns the body of a successful answer; every refusal throws. */
  private async call(req: CallRequest): Promise<unknown> {
    const { status, body } = await this.d.http.send({
      method: req.method,
      path: `${INTERNAL_JOBS_ROUTE}/${req.id}`,
      headers: { authorization: `${SERVICE_TOKEN_SCHEME} ${this.p.serviceToken}` },
      body: req.body,
      signal: req.signal,
    });

    if (status === 404) throw new JobNotFoundError({ id: req.id });
    if (status === 409) {
      throw new JobStatusConflictError({ id: req.id, ...this.statusOf(body) });
    }
    if (status < 200 || status >= 300) {
      throw new InvalidJobError({ id: req.id, issues: this.issuesOf(body) });
    }
    return body;
  }

  /** The job's current status job-service put into its conflict body, if any. */
  private statusOf(body: unknown): { status?: string } {
    const status = (body as { details?: { status?: unknown } } | undefined)?.details?.status;
    return typeof status === 'string' ? { status } : {};
  }

  /** The validation issues job-service put into its error body, if any. */
  private issuesOf(body: unknown): InvalidJobIssue[] {
    const details = (body as { details?: { issues?: unknown } } | undefined)?.details;
    return Array.isArray(details?.issues) ? (details.issues as InvalidJobIssue[]) : [];
  }
}
