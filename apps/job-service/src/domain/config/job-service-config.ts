import type { BaseConfig } from '@job-queue/service-kit';

export const JOB_SERVICE_CONFIG = Symbol('JobServiceConfig');

/** The validated settings of job-service (variable names and initial values in `.env.example`). */
export interface JobServiceConfig extends BaseConfig {
  readonly databaseUrl: string;
  /** The largest request body job-service accepts, in bytes. */
  readonly bodyLimitBytes: number;
  /** Page size of a job query without `limit`. */
  readonly queryDefaultLimit: number;
  /** Largest `limit` a job query may ask for. */
  readonly queryMaxLimit: number;
  /** How long putting a job on the queue may take before the job is left pending. */
  readonly enqueueTimeoutMs: number;
}
