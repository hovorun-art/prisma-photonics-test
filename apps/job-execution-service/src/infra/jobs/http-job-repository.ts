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
import { JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import { JobServiceUnavailableError } from '../../domain/jobs/errors/job-service-unavailable.error.js';
import type {
  GetJobRepositoryRequest,
  GetJobRepositoryResponse,
  JobRepository,
  UpdateJobRepositoryRequest,
  UpdateJobRepositoryResponse,
} from '../../domain/jobs/job-repository.js';

export interface HttpJobRepositoryParams {
  /** job-service's base URL, e.g. `http://job-service:3000`. */
  baseUrl: string;
  serviceToken: string;
  /** How long one call may take before job-service counts as unavailable. */
  timeoutMs: number;
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
 * Network errors, timeouts and 5xx become `JobServiceUnavailableError` (the only retryable error);
 * 404 and 409 map to their own errors; any other refusal is an `InvalidJobError`.
 */
export class HttpJobRepository implements JobRepository {
  constructor(private readonly p: HttpJobRepositoryParams) {}

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
    let response: Response;
    try {
      response = await fetch(new URL(`${INTERNAL_JOBS_ROUTE}/${req.id}`, this.p.baseUrl), {
        method: req.method,
        headers: {
          authorization: `${SERVICE_TOKEN_SCHEME} ${this.p.serviceToken}`,
          ...(req.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
        signal: AbortSignal.any([
          AbortSignal.timeout(this.p.timeoutMs),
          ...(req.signal === undefined ? [] : [req.signal]),
        ]),
      });
    } catch (error) {
      throw new JobServiceUnavailableError({
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (response.status === 404) throw new JobNotFoundError({ id: req.id });
    if (response.status === 409) throw new JobStatusConflictError({ id: req.id });
    if (response.status >= 500) {
      throw new JobServiceUnavailableError({ reason: `HTTP ${response.status}` });
    }
    if (!response.ok) {
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
