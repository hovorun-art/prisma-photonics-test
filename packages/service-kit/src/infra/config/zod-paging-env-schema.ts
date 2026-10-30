import { z } from 'zod';

import type {
  CheckPagingEnvSchemaRequest,
  CheckPagingEnvSchemaResponse,
  CreatePagingEnvSchemaResponse,
  PagingEnvSchema,
  PagingEnvShape,
  ToConfigPagingEnvSchemaRequest,
  ToConfigPagingEnvSchemaResponse,
} from '../../domain/config/paging-env-schema.js';

const DEFAULT_QUERY_DEFAULT_LIMIT = 20;
const DEFAULT_QUERY_MAX_LIMIT = 100;

export interface ZodPagingEnvSchemaParams<TPrefix extends string> {
  /** Prefix of the two variables, e.g. `JOB_SERVICE` for `JOB_SERVICE_QUERY_MAX_LIMIT`. */
  prefix: TPrefix;
}

/**
 * `<PREFIX>_QUERY_DEFAULT_LIMIT` (default 20) and `<PREFIX>_QUERY_MAX_LIMIT` (default 100), positive
 * integers, with the default page size not above the maximum: the paging of every paged query.
 */
export class ZodPagingEnvSchema<TPrefix extends string> implements PagingEnvSchema<TPrefix> {
  constructor(private readonly p: ZodPagingEnvSchemaParams<TPrefix>) {}

  create(): CreatePagingEnvSchemaResponse<TPrefix> {
    // The keys are only known as a type parameter, so TypeScript widens the computed keys.
    const shape = {
      [this.defaultVariable()]: z.coerce
        .number()
        .int()
        .positive()
        .default(DEFAULT_QUERY_DEFAULT_LIMIT),
      [this.maxVariable()]: z.coerce.number().int().positive().default(DEFAULT_QUERY_MAX_LIMIT),
    } as PagingEnvShape<TPrefix>;
    return { shape };
  }

  check(req: CheckPagingEnvSchemaRequest<TPrefix>): CheckPagingEnvSchemaResponse {
    if (req.env[this.defaultVariable()] > req.env[this.maxVariable()]) {
      req.ctx.addIssue({
        code: 'custom',
        path: [this.defaultVariable()],
        message: `must not be above ${this.maxVariable()}`,
      });
    }
    return {};
  }

  toConfig(req: ToConfigPagingEnvSchemaRequest<TPrefix>): ToConfigPagingEnvSchemaResponse {
    return {
      config: {
        queryDefaultLimit: req.env[this.defaultVariable()],
        queryMaxLimit: req.env[this.maxVariable()],
      },
    };
  }

  private defaultVariable(): `${TPrefix}_QUERY_DEFAULT_LIMIT` {
    return `${this.p.prefix}_QUERY_DEFAULT_LIMIT`;
  }

  private maxVariable(): `${TPrefix}_QUERY_MAX_LIMIT` {
    return `${this.p.prefix}_QUERY_MAX_LIMIT`;
  }
}
