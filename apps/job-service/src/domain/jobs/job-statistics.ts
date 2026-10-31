import type { JobStatus, JobType, QueueStats } from '@job-queue/contracts';

/**
 * Queue statistics over jobs of every type, read from job state at the moment of the call: current
 * counts by status, jobs finished within the configured recent window, and the throughput of
 * completed jobs over the configured throughput window. The job counts per status and per type
 * cover all jobs and are faceted by the status and type filters, which change nothing else; the
 * group filter narrows every statistic.
 */
export interface JobStatistics {
  get(req: GetJobStatisticsRequest): Promise<GetJobStatisticsResponse>;
}

export interface GetJobStatisticsRequest {
  /** Narrows the counts per type to jobs in this status. */
  status?: JobStatus;
  /** Narrows the counts per status to jobs of this type. */
  type?: JobType;
  /** Narrows every statistic to this group's jobs, or (`null`) to the jobs without a group. */
  groupId?: string | null | undefined;
}

export interface GetJobStatisticsResponse {
  stats: QueueStats;
}

export const JOB_STATISTICS = Symbol('JobStatistics');
