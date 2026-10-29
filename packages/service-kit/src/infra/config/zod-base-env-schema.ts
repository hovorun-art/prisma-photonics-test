import { z } from 'zod';

import { LOG_LEVELS, NODE_ENVS, type NodeEnv } from '../../domain/config/base-config.js';
import type {
  BaseEnvSchema,
  BaseEnvShape,
  CreateBaseEnvSchemaResponse,
  ToConfigBaseEnvSchemaRequest,
  ToConfigBaseEnvSchemaResponse,
} from '../../domain/config/base-env-schema.js';

export interface ZodBaseEnvSchemaParams<TPortVariable extends string> {
  /** Name of the variable holding the service's HTTP port (e.g. `JOB_SERVICE_PORT`). */
  portVariable: TPortVariable;
  /** The environment when `NODE_ENV` is not set. */
  defaultNodeEnv: NodeEnv;
}

/** `NODE_ENV`, `LOG_LEVEL`, `REDIS_URL` and the port variable as one Zod object. */
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
      },
    };
  }
}
