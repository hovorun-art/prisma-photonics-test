import type { z } from 'zod';

/** The page sizes of a service's paged query (variable names and defaults in `.env.example`). */
export interface PagingConfig {
  /** Page size of a query without `limit`. */
  readonly queryDefaultLimit: number;
  /** Largest `limit` a query may ask for. */
  readonly queryMaxLimit: number;
}

/** The two paging variables of a service, named by its prefix (e.g. `JOB_SERVICE_QUERY_MAX_LIMIT`). */
export type PagingVariable<TPrefix extends string> =
  `${TPrefix}_QUERY_DEFAULT_LIMIT` | `${TPrefix}_QUERY_MAX_LIMIT`;

export type PagingEnvShape<TPrefix extends string = string> = Record<
  PagingVariable<TPrefix>,
  z.ZodDefault<z.ZodCoercedNumber>
>;

export type PagingEnv<TPrefix extends string = string> = Record<PagingVariable<TPrefix>, number>;

/** The paging variables of a service's environment, their defaults and their cross-check. */
export interface PagingEnvSchema<TPrefix extends string = string> {
  /** The fields to spread into the app's environment schema. */
  create(): CreatePagingEnvSchemaResponse<TPrefix>;
  /** Run in the app schema's `superRefine`: the default page size must not be above the maximum. */
  check(req: CheckPagingEnvSchemaRequest<TPrefix>): CheckPagingEnvSchemaResponse;
  /** The paging settings of a parsed environment, for the app's config to spread in. */
  toConfig(req: ToConfigPagingEnvSchemaRequest<TPrefix>): ToConfigPagingEnvSchemaResponse;
}

export interface CreatePagingEnvSchemaResponse<TPrefix extends string = string> {
  shape: PagingEnvShape<TPrefix>;
}

export interface CheckPagingEnvSchemaRequest<TPrefix extends string = string> {
  env: PagingEnv<TPrefix>;
  ctx: z.RefinementCtx;
}

export type CheckPagingEnvSchemaResponse = Record<string, never>;

export interface ToConfigPagingEnvSchemaRequest<TPrefix extends string = string> {
  env: PagingEnv<TPrefix>;
}

export interface ToConfigPagingEnvSchemaResponse {
  config: PagingConfig;
}
