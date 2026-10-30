import type { z } from 'zod';

import type { BaseConfig, CoreConfig, LogLevel, NodeEnv } from './base-config.js';

/**
 * The environment variables every backend service reads; an app extends it with its own. The
 * port variable is named by the app (`TPortVariable`, e.g. `JOB_GROUP_SERVICE_PORT`).
 */
export type CoreEnvShape<TPortVariable extends string = string> = {
  NODE_ENV: z.ZodDefault<z.ZodEnum<{ [K in NodeEnv]: K }>>;
  LOG_LEVEL: z.ZodDefault<z.ZodEnum<{ [K in LogLevel]: K }>>;
} & Record<TPortVariable, z.ZodCoercedNumber>;

/** A parsed core environment (spelled out, since inference stops at a generic key). */
export type CoreEnv<TPortVariable extends string = string> = {
  NODE_ENV: NodeEnv;
  LOG_LEVEL: LogLevel;
} & Record<TPortVariable, number>;

/** The core variables plus the ones of a backend on the job queue (Redis, internal API token). */
export type BaseEnvShape<TPortVariable extends string = string> = CoreEnvShape<TPortVariable> & {
  REDIS_URL: z.ZodURL;
  INTERNAL_SERVICE_TOKEN: z.ZodString;
  JOB_LOG_STREAM_MAX_LENGTH: z.ZodDefault<z.ZodCoercedNumber>;
};

/** A parsed environment: what `BaseEnvShape` yields. */
export type BaseEnv<TPortVariable extends string = string> = CoreEnv<TPortVariable> & {
  REDIS_URL: string;
  INTERNAL_SERVICE_TOKEN: string;
  JOB_LOG_STREAM_MAX_LENGTH: number;
};

export interface CoreEnvSchema<TPortVariable extends string = string> {
  /** The core Zod object: `.extend({...})` it with the app's own variables. */
  create(): CreateCoreEnvSchemaResponse<TPortVariable>;
  /** The core settings of a parsed environment, for the app's config to spread in. */
  toConfig(req: ToConfigCoreEnvSchemaRequest<TPortVariable>): ToConfigCoreEnvSchemaResponse;
}

export interface CreateCoreEnvSchemaResponse<TPortVariable extends string = string> {
  schema: z.ZodObject<CoreEnvShape<TPortVariable>>;
}

export interface ToConfigCoreEnvSchemaRequest<TPortVariable extends string = string> {
  env: CoreEnv<TPortVariable>;
}

export interface ToConfigCoreEnvSchemaResponse {
  config: CoreConfig;
}

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
