import { ZodConfigParser, ZodCoreEnvSchema } from '@job-queue/service-kit';
import { z } from 'zod';

import type { JobGroupServiceConfig } from '../../domain/config/job-group-service-config.js';

const DEFAULT_JOB_SERVICE_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_BATCH_SIZE = 100;
const DEFAULT_QUERY_DEFAULT_LIMIT = 20;
const DEFAULT_QUERY_MAX_LIMIT = 100;

const coreEnv = new ZodCoreEnvSchema({
  defaultNodeEnv: 'development',
  portVariable: 'JOB_GROUP_SERVICE_PORT',
});

/**
 * The database URL names the app's own Postgres schema (`?schema=job_groups`), as `prisma migrate`
 * needs it; the connection pool gets the schema as an option and the URL without it.
 */
const DatabaseUrl = z
  .url({ protocol: /^postgres(ql)?$/ })
  .refine((url) => new URL(url).searchParams.get('schema'), {
    message: 'must name the Postgres schema, e.g. ?schema=job_groups',
  });

/** job-group-service's environment variables (names and initial values in `.env.example`). */
const JobGroupServiceEnv = coreEnv
  .create()
  .schema.extend({
    JOB_GROUP_SERVICE_DATABASE_URL: DatabaseUrl,
    JOB_SERVICE_URL: z.url({ protocol: /^https?$/ }),
    JOB_GROUP_JOB_SERVICE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_JOB_SERVICE_TIMEOUT_MS),
    JOB_GROUP_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_POLL_INTERVAL_MS),
    JOB_GROUP_POLL_BATCH_SIZE: z.coerce.number().int().positive().default(DEFAULT_POLL_BATCH_SIZE),
    JOB_GROUP_QUERY_DEFAULT_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_QUERY_DEFAULT_LIMIT),
    JOB_GROUP_QUERY_MAX_LIMIT: z.coerce.number().int().positive().default(DEFAULT_QUERY_MAX_LIMIT),
  })
  .refine((env) => env.JOB_GROUP_QUERY_DEFAULT_LIMIT <= env.JOB_GROUP_QUERY_MAX_LIMIT, {
    path: ['JOB_GROUP_QUERY_DEFAULT_LIMIT'],
    message: 'must not be above JOB_GROUP_QUERY_MAX_LIMIT',
  })
  .transform((env): JobGroupServiceConfig => {
    const databaseUrl = new URL(env.JOB_GROUP_SERVICE_DATABASE_URL);
    const databaseSchema = databaseUrl.searchParams.get('schema') ?? '';
    databaseUrl.searchParams.delete('schema');
    return {
      ...coreEnv.toConfig({ env }).config,
      databaseUrl: databaseUrl.toString(),
      databaseSchema,
      jobServiceUrl: env.JOB_SERVICE_URL,
      jobServiceTimeoutMs: env.JOB_GROUP_JOB_SERVICE_TIMEOUT_MS,
      pollIntervalMs: env.JOB_GROUP_POLL_INTERVAL_MS,
      pollBatchSize: env.JOB_GROUP_POLL_BATCH_SIZE,
      queryDefaultLimit: env.JOB_GROUP_QUERY_DEFAULT_LIMIT,
      queryMaxLimit: env.JOB_GROUP_QUERY_MAX_LIMIT,
    };
  });

/** Validates the environment with the shared core schema extended by job-group-service's own fields. */
export class ZodJobGroupServiceConfigParser extends ZodConfigParser<JobGroupServiceConfig> {
  constructor() {
    super({ schema: JobGroupServiceEnv });
  }
}
