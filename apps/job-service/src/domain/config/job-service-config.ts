import type { BaseConfig } from '@job-queue/service-kit';

export const JOB_SERVICE_CONFIG = Symbol('JobServiceConfig');

/** The validated settings of job-service (variable names and initial values in `.env.example`). */
export interface JobServiceConfig extends BaseConfig {
  readonly databaseUrl: string;
  /** The largest request body job-service accepts, in bytes. */
  readonly bodyLimitBytes: number;
  /** The shared token job-execution-service presents on every `/internal` call. */
  readonly internalServiceToken: string;
}
