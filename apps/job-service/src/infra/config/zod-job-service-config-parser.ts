import { ZodBaseEnvSchema, ZodConfigParser, ZodPagingEnvSchema } from '@job-queue/service-kit';
import { z } from 'zod';

import type { JobServiceConfig } from '../../domain/config/job-service-config.js';

/** 1 MiB: room for a bulk of the default maximum of jobs at their largest payloads. */
const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const DEFAULT_ENQUEUE_TIMEOUT_MS = 2_000;
const DEFAULT_BULK_MAX_JOBS = 100;
const DEFAULT_STATS_RECENT_WINDOW_MINUTES = 24 * 60;
const DEFAULT_STATS_THROUGHPUT_WINDOW_MINUTES = 5;
const DEFAULT_RETRY_DELAY_MS = { min: 5_000, max: 30_000, cap: 300_000 };
const DEFAULT_RECOVERY = { intervalMs: 30_000, minAgeMs: 30_000, batchSize: 100 };
const DEFAULT_MAX_PROCESSING_MS = { email: 30_000, webhook: 30_000, flightTransit: 60_000 };

const baseEnv = new ZodBaseEnvSchema({
  defaultNodeEnv: 'development',
  portVariable: 'JOB_SERVICE_PORT',
});
const paging = new ZodPagingEnvSchema({ prefix: 'JOB_SERVICE' });

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
    ...paging.create().shape,
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
    JOB_SERVICE_RETRY_MIN_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_RETRY_DELAY_MS.min),
    JOB_SERVICE_RETRY_MAX_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_RETRY_DELAY_MS.max),
    JOB_SERVICE_RETRY_CAP_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_RETRY_DELAY_MS.cap),
    JOB_SERVICE_RECOVERY_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_RECOVERY.intervalMs),
    JOB_SERVICE_RECOVERY_MIN_AGE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_RECOVERY.minAgeMs),
    JOB_SERVICE_RECOVERY_BATCH_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_RECOVERY.batchSize),
    JOB_SERVICE_MAX_PROCESSING_MS_EMAIL: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_PROCESSING_MS.email),
    JOB_SERVICE_MAX_PROCESSING_MS_WEBHOOK: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_PROCESSING_MS.webhook),
    JOB_SERVICE_MAX_PROCESSING_MS_FLIGHT_TRANSIT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_PROCESSING_MS.flightTransit),
  })
  .superRefine((env, ctx) => {
    paging.check({ env, ctx });
    if (env.JOB_SERVICE_RETRY_MIN_DELAY_MS > env.JOB_SERVICE_RETRY_MAX_DELAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['JOB_SERVICE_RETRY_MIN_DELAY_MS'],
        message: 'must not be above JOB_SERVICE_RETRY_MAX_DELAY_MS',
      });
    }
    if (env.JOB_SERVICE_RETRY_MAX_DELAY_MS > env.JOB_SERVICE_RETRY_CAP_DELAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['JOB_SERVICE_RETRY_MAX_DELAY_MS'],
        message: 'must not be above JOB_SERVICE_RETRY_CAP_DELAY_MS',
      });
    }
  })
  .transform((env): JobServiceConfig => ({
    ...baseEnv.toConfig({ env }).config,
    bodyLimitBytes: env.JOB_SERVICE_BODY_LIMIT_BYTES,
    databaseUrl: env.DATABASE_URL,
    ...paging.toConfig({ env }).config,
    enqueueTimeoutMs: env.JOB_SERVICE_ENQUEUE_TIMEOUT_MS,
    bulkMaxJobs: env.JOB_SERVICE_BULK_MAX_JOBS,
    statsRecentWindowMinutes: env.JOB_SERVICE_STATS_RECENT_WINDOW_MINUTES,
    statsThroughputWindowMinutes: env.JOB_SERVICE_STATS_THROUGHPUT_WINDOW_MINUTES,
    retryDelay: {
      minMs: env.JOB_SERVICE_RETRY_MIN_DELAY_MS,
      maxMs: env.JOB_SERVICE_RETRY_MAX_DELAY_MS,
      capMs: env.JOB_SERVICE_RETRY_CAP_DELAY_MS,
    },
    recovery: {
      intervalMs: env.JOB_SERVICE_RECOVERY_INTERVAL_MS,
      minAgeMs: env.JOB_SERVICE_RECOVERY_MIN_AGE_MS,
      batchSize: env.JOB_SERVICE_RECOVERY_BATCH_SIZE,
    },
    maxProcessingMs: {
      email: env.JOB_SERVICE_MAX_PROCESSING_MS_EMAIL,
      webhook: env.JOB_SERVICE_MAX_PROCESSING_MS_WEBHOOK,
      'flight-transit': env.JOB_SERVICE_MAX_PROCESSING_MS_FLIGHT_TRANSIT,
    },
  }));

/** Validates the environment with the shared base schema extended by job-service's own fields. */
export class ZodJobServiceConfigParser extends ZodConfigParser<JobServiceConfig> {
  constructor() {
    super({ schema: JobServiceEnv });
  }
}
