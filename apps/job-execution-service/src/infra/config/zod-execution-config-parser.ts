import { ZodBaseEnvSchema, ZodConfigParser } from '@job-queue/service-kit';

import type { ExecutionConfig } from '../../domain/config/execution-config.js';

const baseEnv = new ZodBaseEnvSchema({
  defaultNodeEnv: 'production',
  portVariable: 'JOB_EXECUTION_SERVICE_PORT',
});

/** The environment of job-execution-service (names as in `.env.example`). */
const ExecutionEnv = baseEnv
  .create()
  .schema.transform((env): ExecutionConfig => baseEnv.toConfig({ env }).config);

/** Validates the environment with the shared base schema extended by the service's own fields. */
export class ZodExecutionConfigParser extends ZodConfigParser<ExecutionConfig> {
  constructor() {
    super({ schema: ExecutionEnv });
  }
}
