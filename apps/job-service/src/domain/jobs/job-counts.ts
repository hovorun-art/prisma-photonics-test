import type { JobStatus, JobType } from '@job-queue/contracts';

/** Counts of stored jobs; each method reads one consistent snapshot. */
export interface JobCounts {
  count(req: CountJobCountsRequest): Promise<CountJobCountsResponse>;
  /** Every stored job, whenever it was created or finished, counted per status and type pair. */
  countByStatusAndType(
    req: CountByStatusAndTypeJobCountsRequest,
  ): Promise<CountByStatusAndTypeJobCountsResponse>;
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

export interface CountByStatusAndTypeJobCountsRequest {
  /** Only jobs of this group, or (`null`) only jobs without one; every job when omitted. */
  groupId?: string | null | undefined;
}

/** One cell per status and type pair that has jobs; pairs without jobs are left out. */
export interface CountByStatusAndTypeJobCountsResponse {
  cells: { status: JobStatus; type: JobType; count: number }[];
}

export const JOB_COUNTS = Symbol('JobCounts');
