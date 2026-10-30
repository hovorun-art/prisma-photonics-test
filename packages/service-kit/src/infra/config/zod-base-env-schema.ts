import { z } from 'zod';

import { LOG_LEVELS, NODE_ENVS, type NodeEnv } from '../../domain/config/base-config.js';
import type {
  BaseEnvSchema,
  BaseEnvShape,
  CreateBaseEnvSchemaResponse,
  ToConfigBaseEnvSchemaRequest,
  ToConfigBaseEnvSchemaResponse,
} from '../../domain/config/base-env-schema.js';

/** Entries the job log stream keeps: minutes of a log store outage at high load. */
const DEFAULT_JOB_LOG_STREAM_MAX_LENGTH = 100_000;

export interface ZodBaseEnvSchemaParams<TPortVariable extends string> {
  /** Name of the variable holding the service's HTTP port (e.g. `JOB_SERVICE_PORT`). */
  portVariable: TPortVariable;
  /** The environment when `NODE_ENV` is not set. */
  defaultNodeEnv: NodeEnv;
}

/**
 * `NODE_ENV`, `LOG_LEVEL`, `REDIS_URL`, `INTERNAL_SERVICE_TOKEN`, `JOB_LOG_STREAM_MAX_LENGTH` and the
 * port variable as one Zod object.
 */
export class ZodBaseEnvSchema<
  TPortVariable extends string,
> implements BaseEnvSchema<TPortVariable> {
  constructor(private readonly p: ZodBaseEnvSchemaParams<TPortVariable>) {}

  create(): CreateBaseEnvSchemaResponse<TPortVariable> {
    const port = z.coerce.number().int().min(0).max(65_535);
    // The key is only known as a type parameter, so TypeScript widens the computed key.
    const shape = {
      NODE_ENV: z.enum(NODE_ENVS).default(this.p.defaultNodeEnv),
      LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
      REDIS_URL: z.url({ protocol: /^rediss?$/ }),
      INTERNAL_SERVICE_TOKEN: z.string().min(1, 'must be a non-empty service token'),
      JOB_LOG_STREAM_MAX_LENGTH: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_JOB_LOG_STREAM_MAX_LENGTH),
      [this.p.portVariable]: port,
    } as BaseEnvShape<TPortVariable>;
    return { schema: z.object(shape) };
  }

  toConfig(req: ToConfigBaseEnvSchemaRequest<TPortVariable>): ToConfigBaseEnvSchemaResponse {
    return {
      config: {
        nodeEnv: req.env.NODE_ENV,
        logLevel: req.env.LOG_LEVEL,
        redisUrl: req.env.REDIS_URL,
        port: req.env[this.p.portVariable],
        internalServiceToken: req.env.INTERNAL_SERVICE_TOKEN,
        jobLogStreamMaxLength: req.env.JOB_LOG_STREAM_MAX_LENGTH,
      },
    };
  }
}
