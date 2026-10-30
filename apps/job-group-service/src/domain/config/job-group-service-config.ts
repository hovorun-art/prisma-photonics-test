import type { CoreConfig } from '@job-queue/service-kit';

export const JOB_GROUP_SERVICE_CONFIG = Symbol('JobGroupServiceConfig');

/** The validated settings of job-group-service (variable names and initial values in `.env.example`). */
export interface JobGroupServiceConfig extends CoreConfig {
  /** Connection string of the shared database, without the schema parameter. */
  readonly databaseUrl: string;
  /** The Postgres schema that holds job-group-service's tables (`job_groups`). */
  readonly databaseSchema: string;
  /** job-service's base URL, e.g. `http://job-service:3000`. */
  readonly jobServiceUrl: string;
  /** How long one call to job-service may take before it counts as unavailable. */
  readonly jobServiceTimeoutMs: number;
  /** Time between two polls of the running groups. */
  readonly pollIntervalMs: number;
  /** Running groups read from the database at a time during a poll. */
  readonly pollBatchSize: number;
  /** Page size of a group query without `limit`. */
  readonly queryDefaultLimit: number;
  /** Largest `limit` a group query may ask for. */
  readonly queryMaxLimit: number;
}
