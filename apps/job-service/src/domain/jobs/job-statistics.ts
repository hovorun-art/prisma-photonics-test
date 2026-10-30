import type { QueueStats } from '@job-queue/contracts';

/**
 * Queue statistics over jobs of every type, read from job state at the moment of the call: current
 * counts by status, jobs finished within the configured recent window, and the throughput of
 * completed jobs over the configured throughput window.
 */
export interface JobStatistics {
  get(): Promise<GetJobStatisticsResponse>;
}

export interface GetJobStatisticsResponse {
  stats: QueueStats;
}

export const JOB_STATISTICS = Symbol('JobStatistics');
