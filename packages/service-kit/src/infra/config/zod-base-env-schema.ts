import { z } from 'zod';

import type { NodeEnv } from '../../domain/config/base-config.js';
import type {
  BaseEnvSchema,
  BaseEnvShape,
  CreateBaseEnvSchemaResponse,
  ToConfigBaseEnvSchemaRequest,
  ToConfigBaseEnvSchemaResponse,
} from '../../domain/config/base-env-schema.js';
import { ZodCoreEnvSchema } from './zod-core-env-schema.js';

export interface ZodBaseEnvSchemaParams<TPortVariable extends string> {
  /** Name of the variable holding the service's HTTP port (e.g. `JOB_SERVICE_PORT`). */
  portVariable: TPortVariable;
  /** The environment when `NODE_ENV` is not set. */
  defaultNodeEnv: NodeEnv;
}

/**
 * The core variables (`ZodCoreEnvSchema`) plus `REDIS_URL` and `INTERNAL_SERVICE_TOKEN`, as one Zod
 * object: what a backend on the job queue reads.
 */
export class ZodBaseEnvSchema<
  TPortVariable extends string,
> implements BaseEnvSchema<TPortVariable> {
  constructor(private readonly p: ZodBaseEnvSchemaParams<TPortVariable>) {}

  create(): CreateBaseEnvSchemaResponse<TPortVariable> {
    const shape = {
      ...this.core().create().schema.shape,
      REDIS_URL: z.url({ protocol: /^rediss?$/ }),
      INTERNAL_SERVICE_TOKEN: z.string().min(1, 'must be a non-empty service token'),
    } as BaseEnvShape<TPortVariable>;
    return { schema: z.object(shape) };
  }

  toConfig(req: ToConfigBaseEnvSchemaRequest<TPortVariable>): ToConfigBaseEnvSchemaResponse {
    return {
      config: {
        ...this.core().toConfig({ env: req.env }).config,
        redisUrl: req.env.REDIS_URL,
        internalServiceToken: req.env.INTERNAL_SERVICE_TOKEN,
      },
    };
  }

  private core(): ZodCoreEnvSchema<TPortVariable> {
    return new ZodCoreEnvSchema(this.p);
  }
}
