import type { JobType } from '@job-queue/contracts';
import type { BaseConfig, PagingConfig } from '@job-queue/service-kit';

export const JOB_SERVICE_CONFIG = Symbol('JobServiceConfig');

/** The validated settings of job-service (variable names and initial values in `.env.example`). */
export interface JobServiceConfig extends BaseConfig, PagingConfig {
  readonly databaseUrl: string;
  /** The largest request body job-service accepts on any route (a bulk included), in bytes. */
  readonly bodyLimitBytes: number;
  /** How long putting a job on the queue may take before the job is left pending. */
  readonly enqueueTimeoutMs: number;
  /** Most jobs one bulk submission may hold. */
  readonly bulkMaxJobs: number;
  /** Length of the window in which `GET /v1/stats` counts completed and failed jobs. */
  readonly statsRecentWindowMinutes: number;
  /** Length of the window over which `GET /v1/stats` measures throughput. */
  readonly statsThroughputWindowMinutes: number;
  /**
   * The wait before an automatic retry: retry n draws from [minMs, maxMs] × 2^(n−1), each bound
   * capped at `capMs`.
   */
  readonly retryDelay: { readonly minMs: number; readonly maxMs: number; readonly capMs: number };
  /**
   * The recovery pass: how often it runs, how long a job must have been in its state before the pass
   * looks at it, and how many jobs of each kind (waiting, processing) one pass reads.
   */
  readonly recovery: {
    readonly intervalMs: number;
    readonly minAgeMs: number;
    readonly batchSize: number;
  };
  /** How long one attempt of each job type may run before it fails with `JOB_TIMEOUT`. */
  readonly maxProcessingMs: Readonly<Record<JobType, number>>;
}
