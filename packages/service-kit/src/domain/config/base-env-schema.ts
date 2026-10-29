import type { z } from 'zod';

import type { BaseConfig, LogLevel, NodeEnv } from './base-config.js';

/**
 * The environment variables every backend service reads; an app extends it with its own. The
 * port variable is named by the app (`TPortVariable`, e.g. `JOB_SERVICE_PORT`).
 */
export type BaseEnvShape<TPortVariable extends string = string> = {
  NODE_ENV: z.ZodDefault<z.ZodEnum<{ [K in NodeEnv]: K }>>;
  LOG_LEVEL: z.ZodDefault<z.ZodEnum<{ [K in LogLevel]: K }>>;
  REDIS_URL: z.ZodURL;
} & Record<TPortVariable, z.ZodCoercedNumber>;

/** A parsed environment: what `BaseEnvShape` yields (spelled out, since inference stops at a generic key). */
export type BaseEnv<TPortVariable extends string = string> = {
  NODE_ENV: NodeEnv;
  LOG_LEVEL: LogLevel;
  REDIS_URL: string;
} & Record<TPortVariable, number>;

export interface BaseEnvSchema<TPortVariable extends string = string> {
  /** The base Zod object: `.extend({...})` it with the app's own variables. */
  create(): CreateBaseEnvSchemaResponse<TPortVariable>;
  /** The base settings of a parsed environment, for the app's config to spread in. */
  toConfig(req: ToConfigBaseEnvSchemaRequest<TPortVariable>): ToConfigBaseEnvSchemaResponse;
}

export interface CreateBaseEnvSchemaResponse<TPortVariable extends string = string> {
  schema: z.ZodObject<BaseEnvShape<TPortVariable>>;
}

export interface ToConfigBaseEnvSchemaRequest<TPortVariable extends string = string> {
  env: BaseEnv<TPortVariable>;
}

export interface ToConfigBaseEnvSchemaResponse {
  config: BaseConfig;
}
