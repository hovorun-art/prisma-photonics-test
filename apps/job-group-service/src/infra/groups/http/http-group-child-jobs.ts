import { JOBS_ROUTE, QueryJobsResponse } from '@job-queue/contracts';
import { JobServiceUnavailableError } from '@job-queue/kernel';

import type {
  CountGroupChildJobsRequest,
  CountGroupChildJobsResponse,
  GroupChildJobs,
} from '../../../domain/groups/group-child-jobs.js';

export interface HttpGroupChildJobsParams {
  /** job-service's base URL, e.g. `http://job-service:3000`. */
  baseUrl: string;
  /** How long one call may take before job-service counts as unavailable. */
  timeoutMs: number;
}

interface TotalRequest {
  groupId: string;
  statuses: string[];
}

/**
 * Counts a group's children with three parallel `GET /v1/jobs?groupId=...&limit=1` calls that read
 * only `total`: all jobs, `completed`, and `failed` plus `cancelled`; `total` is never below the
 * finished ones. Network errors, timeouts and
 * 5xx become `JobServiceUnavailableError`; any other refusal or a body that does not parse as
 * `QueryJobsResponse` is thrown as a plain `Error` (unexpected).
 */
export class HttpGroupChildJobs implements GroupChildJobs {
  constructor(private readonly p: HttpGroupChildJobsParams) {}

  async count(req: CountGroupChildJobsRequest): Promise<CountGroupChildJobsResponse> {
    const [total, completed, failed] = await Promise.all([
      this.total({ groupId: req.groupId, statuses: [] }),
      this.total({ groupId: req.groupId, statuses: ['completed'] }),
      this.total({ groupId: req.groupId, statuses: ['failed', 'cancelled'] }),
    ]);
    // The three answers are not one snapshot: a child submitted and finished between them can be
    // counted as finished but not in all, so `total` is never below the finished ones.
    return { total: Math.max(total, completed + failed), completed, failed };
  }

  private async total(req: TotalRequest): Promise<number> {
    const url = new URL(JOBS_ROUTE, this.p.baseUrl);
    url.searchParams.set('groupId', req.groupId);
    url.searchParams.set('limit', '1');
    for (const status of req.statuses) url.searchParams.append('status', status);

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(this.p.timeoutMs) });
    } catch (error) {
      throw new JobServiceUnavailableError({
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    if (response.status >= 500) {
      throw new JobServiceUnavailableError({ reason: `HTTP ${response.status}` });
    }
    if (!response.ok) {
      throw new Error(`job-service refused the group count with HTTP ${response.status}`);
    }

    const parsed = QueryJobsResponse.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new Error('job-service answered the group count with an unexpected body', {
        cause: parsed.error,
      });
    }
    return parsed.data.total;
  }
}
