import { ZodBaseEnvSchema, ZodConfigParser } from '@job-queue/service-kit';
import { z } from 'zod';

import type { JobServiceConfig } from '../../domain/config/job-service-config.js';

/** 1 MiB: room for a bulk of the default maximum of jobs at their largest payloads. */
const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const DEFAULT_QUERY_DEFAULT_LIMIT = 20;
const DEFAULT_QUERY_MAX_LIMIT = 100;
const DEFAULT_ENQUEUE_TIMEOUT_MS = 2_000;
const DEFAULT_BULK_MAX_JOBS = 100;
const DEFAULT_STATS_RECENT_WINDOW_MINUTES = 24 * 60;
const DEFAULT_STATS_THROUGHPUT_WINDOW_MINUTES = 5;

const baseEnv = new ZodBaseEnvSchema({
  defaultNodeEnv: 'development',
  portVariable: 'JOB_SERVICE_PORT',
});

/** job-service's environment variables (names and initial values in `.env.example`). */
const JobServiceEnv = baseEnv
  .create()
  .schema.extend({
    JOB_SERVICE_BODY_LIMIT_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_BODY_LIMIT_BYTES),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    JOB_SERVICE_QUERY_DEFAULT_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_QUERY_DEFAULT_LIMIT),
    JOB_SERVICE_QUERY_MAX_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_QUERY_MAX_LIMIT),
    JOB_SERVICE_ENQUEUE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_ENQUEUE_TIMEOUT_MS),
    JOB_SERVICE_BULK_MAX_JOBS: z.coerce.number().int().positive().default(DEFAULT_BULK_MAX_JOBS),
    JOB_SERVICE_STATS_RECENT_WINDOW_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_STATS_RECENT_WINDOW_MINUTES),
    JOB_SERVICE_STATS_THROUGHPUT_WINDOW_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_STATS_THROUGHPUT_WINDOW_MINUTES),
  })
  .refine((env) => env.JOB_SERVICE_QUERY_DEFAULT_LIMIT <= env.JOB_SERVICE_QUERY_MAX_LIMIT, {
    path: ['JOB_SERVICE_QUERY_DEFAULT_LIMIT'],
    message: 'must not be above JOB_SERVICE_QUERY_MAX_LIMIT',
  })
  .transform((env): JobServiceConfig => ({
    ...baseEnv.toConfig({ env }).config,
    bodyLimitBytes: env.JOB_SERVICE_BODY_LIMIT_BYTES,
    databaseUrl: env.DATABASE_URL,
    queryDefaultLimit: env.JOB_SERVICE_QUERY_DEFAULT_LIMIT,
    queryMaxLimit: env.JOB_SERVICE_QUERY_MAX_LIMIT,
    enqueueTimeoutMs: env.JOB_SERVICE_ENQUEUE_TIMEOUT_MS,
    bulkMaxJobs: env.JOB_SERVICE_BULK_MAX_JOBS,
    statsRecentWindowMinutes: env.JOB_SERVICE_STATS_RECENT_WINDOW_MINUTES,
    statsThroughputWindowMinutes: env.JOB_SERVICE_STATS_THROUGHPUT_WINDOW_MINUTES,
  }));

/** Validates the environment with the shared base schema extended by job-service's own fields. */
export class ZodJobServiceConfigParser extends ZodConfigParser<JobServiceConfig> {
  constructor() {
    super({ schema: JobServiceEnv });
  }
}
