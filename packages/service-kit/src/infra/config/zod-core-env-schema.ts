import { z } from 'zod';

import { LOG_LEVELS, NODE_ENVS, type NodeEnv } from '../../domain/config/base-config.js';
import type {
  CoreEnvSchema,
  CoreEnvShape,
  CreateCoreEnvSchemaResponse,
  ToConfigCoreEnvSchemaRequest,
  ToConfigCoreEnvSchemaResponse,
} from '../../domain/config/base-env-schema.js';

export interface ZodCoreEnvSchemaParams<TPortVariable extends string> {
  /** Name of the variable holding the service's HTTP port (e.g. `JOB_GROUP_SERVICE_PORT`). */
  portVariable: TPortVariable;
  /** The environment when `NODE_ENV` is not set. */
  defaultNodeEnv: NodeEnv;
}

/** `NODE_ENV`, `LOG_LEVEL` and the port variable as one Zod object: what every backend reads. */
export class ZodCoreEnvSchema<
  TPortVariable extends string,
> implements CoreEnvSchema<TPortVariable> {
  constructor(private readonly p: ZodCoreEnvSchemaParams<TPortVariable>) {}

  create(): CreateCoreEnvSchemaResponse<TPortVariable> {
    // The key is only known as a type parameter, so TypeScript widens the computed key.
    const shape = {
      NODE_ENV: z.enum(NODE_ENVS).default(this.p.defaultNodeEnv),
      LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
      [this.p.portVariable]: z.coerce.number().int().min(0).max(65_535),
    } as CoreEnvShape<TPortVariable>;
    return { schema: z.object(shape) };
  }

  toConfig(req: ToConfigCoreEnvSchemaRequest<TPortVariable>): ToConfigCoreEnvSchemaResponse {
    return {
      config: {
        nodeEnv: req.env.NODE_ENV,
        logLevel: req.env.LOG_LEVEL,
        port: req.env[this.p.portVariable],
      },
    };
  }
}
