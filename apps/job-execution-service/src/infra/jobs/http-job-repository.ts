import {
  INTERNAL_JOBS_ROUTE,
  Job,
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
  /** Check the answer against the `Job` schema; off for an accepted report. */
  validate: boolean;
}

interface CallResponse {
  job: Job;
}

/**
 * job-service's internal job API over HTTP. A read is validated with the shared `Job` schema; the
 * job in the answer to an accepted report is passed through unchecked, since the step already took
 * effect and a corrupted payload must not hide that (it is reported once it is read).
 * An unavailable job-service (network error, timeout, 5xx) surfaces as `JobServiceUnavailableError`
 * (the only retryable error); 404 and 409 map to their own errors; any other refusal is an
 * `InvalidJobError`.
 */
export class HttpJobRepository implements JobRepository {
  constructor(
    private readonly d: HttpJobRepositoryDeps,
    private readonly p: HttpJobRepositoryParams,
  ) {}

  get(req: GetJobRepositoryRequest): Promise<GetJobRepositoryResponse> {
    return this.call({ id: req.id, method: 'GET', signal: req.signal, validate: true });
  }

  update(req: UpdateJobRepositoryRequest): Promise<UpdateJobRepositoryResponse> {
    return this.call({
      id: req.id,
      method: 'PATCH',
      body: req.update,
      signal: req.signal,
      validate: false,
    });
  }

  private async call(req: CallRequest): Promise<CallResponse> {
    const { status, body } = await this.d.http.send({
      method: req.method,
      path: `${INTERNAL_JOBS_ROUTE}/${req.id}`,
      headers: { authorization: `${SERVICE_TOKEN_SCHEME} ${this.p.serviceToken}` },
      body: req.body,
      signal: req.signal,
    });

    if (status === 404) throw new JobNotFoundError({ id: req.id });
    if (status === 409) throw new JobStatusConflictError({ id: req.id });
    if (status < 200 || status >= 300) {
      throw new InvalidJobError({ id: req.id, issues: this.issuesOf(body) });
    }

    if (!req.validate) return { job: body as Job };
    const parsed = Job.safeParse(body);
    if (!parsed.success) throw new InvalidJobError({ id: req.id, issues: parsed.error.issues });
    return { job: parsed.data };
  }

  /** The validation issues job-service put into its error body, if any. */
  private issuesOf(body: unknown): InvalidJobIssue[] {
    const details = (body as { details?: { issues?: unknown } } | undefined)?.details;
    return Array.isArray(details?.issues) ? (details.issues as InvalidJobIssue[]) : [];
  }
}
