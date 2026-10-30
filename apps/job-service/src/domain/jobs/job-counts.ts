/** Counts of stored jobs, read in one consistent snapshot. */
export interface JobCounts {
  count(req: CountJobCountsRequest): Promise<CountJobCountsResponse>;
}

export interface CountJobCountsRequest {
  /** Start of the recent window (ISO 8601): jobs that completed or failed at or after it count. */
  recentSince: string;
  /** Start of the throughput window (ISO 8601): jobs that completed at or after it count. */
  throughputSince: string;
}

export interface CountJobCountsResponse {
  /** Jobs in status pending, processing and scheduled now. */
  pending: number;
  processing: number;
  scheduled: number;
  /** Jobs in status completed / failed that finished at or after `recentSince`. */
  recentCompleted: number;
  recentFailed: number;
  /** Jobs in status completed that finished at or after `throughputSince`. */
  throughputCompleted: number;
}

export const JOB_COUNTS = Symbol('JobCounts');
