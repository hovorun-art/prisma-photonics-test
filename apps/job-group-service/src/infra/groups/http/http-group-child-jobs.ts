import { JOBS_ROUTE, type JobStatus, QueryJobsResponse } from '@job-queue/contracts';
import type { JobServiceHttp } from '@job-queue/kernel';

import type {
  CountGroupChildJobsRequest,
  CountGroupChildJobsResponse,
  GroupChildJobs,
} from '../../../domain/groups/group-child-jobs.js';

export interface HttpGroupChildJobsDeps {
  /** job-service's public API; it throws `JobServiceUnavailableError` for an outage. */
  http: JobServiceHttp;
}

interface TotalRequest {
  groupId: string;
  statuses: JobStatus[];
}

/**
 * Counts a group's children with three parallel `GET /v1/jobs?groupId=...&limit=1` calls that read
 * only `total`: all jobs, `completed`, and `failed` plus `cancelled`; `total` is never below the
 * finished ones. An unavailable job-service surfaces as `JobServiceUnavailableError`; any other
 * refusal or a body that does not parse as `QueryJobsResponse` is thrown as a plain `Error`
 * (unexpected).
 */
export class HttpGroupChildJobs implements GroupChildJobs {
  constructor(private readonly d: HttpGroupChildJobsDeps) {}

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
    const response = await this.d.http.send({
      method: 'GET',
      path: JOBS_ROUTE,
      query: [
        ['groupId', req.groupId],
        ['limit', '1'],
        ...req.statuses.map((status): [string, string] => ['status', status]),
      ],
    });
    if (response.status !== 200) {
      throw new Error(`job-service refused the group count with HTTP ${response.status}`);
    }
    const parsed = QueryJobsResponse.safeParse(response.body);
    if (!parsed.success) {
      throw new Error('job-service answered the group count with an unexpected body', {
        cause: parsed.error,
      });
    }
    return parsed.data.total;
  }
}
