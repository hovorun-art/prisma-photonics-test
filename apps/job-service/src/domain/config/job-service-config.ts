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
  /** The job log store (ClickHouse), with credentials and database: `http://user:pass@host:8123/db`. */
  readonly clickhouseUrl: string;
  /** How long job log entries are kept before the store removes them. */
  readonly jobLogRetentionDays: number;
  /** Page size of a job log query without `limit`. */
  readonly jobLogQueryDefaultLimit: number;
  /** Largest `limit` a job log query may ask for. */
  readonly jobLogQueryMaxLimit: number;
  /** Most entries the writer stores in one batch. */
  readonly jobLogBatchSize: number;
  /** Longest the writer waits after the first entry of a batch before storing it. */
  readonly jobLogFlushIntervalMs: number;
  /** First wait before the writer tries a failed batch again; doubled each time up to the maximum. */
  readonly jobLogStoreRetryDelayMs: number;
  readonly jobLogStoreRetryMaxDelayMs: number;
  /** How long the writer lease lasts without renewal; longer than the longest retry wait. */
  readonly jobLogWriterLeaseMs: number;
}
