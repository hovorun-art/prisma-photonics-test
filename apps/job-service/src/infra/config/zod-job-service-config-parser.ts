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
const DEFAULT_JOB_LOG_RETENTION_DAYS = 30;
const DEFAULT_JOB_LOG_QUERY_DEFAULT_LIMIT = 100;
const DEFAULT_JOB_LOG_QUERY_MAX_LIMIT = 1_000;
const DEFAULT_JOB_LOG_BATCH_SIZE = 1_000;
const DEFAULT_JOB_LOG_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_JOB_LOG_STORE_RETRY_DELAY_MS = 500;
const DEFAULT_JOB_LOG_STORE_RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_JOB_LOG_WRITER_LEASE_MS = 60_000;

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
    CLICKHOUSE_URL: z.url({ protocol: /^https?$/ }),
    JOB_LOG_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_JOB_LOG_RETENTION_DAYS),
    JOB_LOG_QUERY_DEFAULT_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_JOB_LOG_QUERY_DEFAULT_LIMIT),
    JOB_LOG_QUERY_MAX_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_JOB_LOG_QUERY_MAX_LIMIT),
    JOB_LOG_BATCH_SIZE: z.coerce.number().int().positive().default(DEFAULT_JOB_LOG_BATCH_SIZE),
    JOB_LOG_FLUSH_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_JOB_LOG_FLUSH_INTERVAL_MS),
    JOB_LOG_STORE_RETRY_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_JOB_LOG_STORE_RETRY_DELAY_MS),
    JOB_LOG_STORE_RETRY_MAX_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_JOB_LOG_STORE_RETRY_MAX_DELAY_MS),
    JOB_LOG_WRITER_LEASE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_JOB_LOG_WRITER_LEASE_MS),
  })
  .refine((env) => env.JOB_SERVICE_QUERY_DEFAULT_LIMIT <= env.JOB_SERVICE_QUERY_MAX_LIMIT, {
    path: ['JOB_SERVICE_QUERY_DEFAULT_LIMIT'],
    message: 'must not be above JOB_SERVICE_QUERY_MAX_LIMIT',
  })
  .refine((env) => env.JOB_LOG_QUERY_DEFAULT_LIMIT <= env.JOB_LOG_QUERY_MAX_LIMIT, {
    path: ['JOB_LOG_QUERY_DEFAULT_LIMIT'],
    message: 'must not be above JOB_LOG_QUERY_MAX_LIMIT',
  })
  .refine((env) => env.JOB_LOG_STORE_RETRY_DELAY_MS <= env.JOB_LOG_STORE_RETRY_MAX_DELAY_MS, {
    path: ['JOB_LOG_STORE_RETRY_DELAY_MS'],
    message: 'must not be above JOB_LOG_STORE_RETRY_MAX_DELAY_MS',
  })
  // The writer renews its lease between tries; it must outlast the longest wait.
  .refine((env) => env.JOB_LOG_WRITER_LEASE_MS > env.JOB_LOG_STORE_RETRY_MAX_DELAY_MS, {
    path: ['JOB_LOG_WRITER_LEASE_MS'],
    message: 'must be above JOB_LOG_STORE_RETRY_MAX_DELAY_MS',
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
    clickhouseUrl: env.CLICKHOUSE_URL,
    jobLogRetentionDays: env.JOB_LOG_RETENTION_DAYS,
    jobLogQueryDefaultLimit: env.JOB_LOG_QUERY_DEFAULT_LIMIT,
    jobLogQueryMaxLimit: env.JOB_LOG_QUERY_MAX_LIMIT,
    jobLogBatchSize: env.JOB_LOG_BATCH_SIZE,
    jobLogFlushIntervalMs: env.JOB_LOG_FLUSH_INTERVAL_MS,
    jobLogStoreRetryDelayMs: env.JOB_LOG_STORE_RETRY_DELAY_MS,
    jobLogStoreRetryMaxDelayMs: env.JOB_LOG_STORE_RETRY_MAX_DELAY_MS,
    jobLogWriterLeaseMs: env.JOB_LOG_WRITER_LEASE_MS,
  }));

/** Validates the environment with the shared base schema extended by job-service's own fields. */
export class ZodJobServiceConfigParser extends ZodConfigParser<JobServiceConfig> {
  constructor() {
    super({ schema: JobServiceEnv });
  }
}
