import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodPagingEnvSchema } from './zod-paging-env-schema.js';

describe('ZodPagingEnvSchema', () => {
  const paging = new ZodPagingEnvSchema({ prefix: 'APP' });
  const schema = z
    .object(paging.create().shape)
    .superRefine((env, ctx) => {
      paging.check({ env, ctx });
    })
    .transform((env) => paging.toConfig({ env }).config);
  const problems = (env: Record<string, string>): PropertyKey[][] =>
    schema.safeParse(env).error?.issues.map((issue) => issue.path) ?? [];

  it('defaults the page size to 20 and the maximum to 100', () => {
    expect(schema.parse({})).toEqual({ queryDefaultLimit: 20, queryMaxLimit: 100 });
  });

  it('reads the variables named by its prefix', () => {
    expect(schema.parse({ APP_QUERY_DEFAULT_LIMIT: '3', APP_QUERY_MAX_LIMIT: '10' })).toEqual({
      queryDefaultLimit: 3,
      queryMaxLimit: 10,
    });
    expect(
      new ZodPagingEnvSchema({ prefix: 'OTHER' }).create().shape.OTHER_QUERY_MAX_LIMIT.parse('7'),
    ).toBe(7);
  });

  it('accepts 1 and a default equal to the maximum', () => {
    expect(schema.parse({ APP_QUERY_DEFAULT_LIMIT: '1', APP_QUERY_MAX_LIMIT: '1' })).toEqual({
      queryDefaultLimit: 1,
      queryMaxLimit: 1,
    });
  });

  it.each(['0', '-1', '1.5', 'many'])('rejects %s, which is not a positive integer', (value) => {
    expect(problems({ APP_QUERY_DEFAULT_LIMIT: value })).toEqual([['APP_QUERY_DEFAULT_LIMIT']]);
    // A maximum below the default page size also fails the cross-check on the default.
    expect(problems({ APP_QUERY_MAX_LIMIT: value })).toContainEqual(['APP_QUERY_MAX_LIMIT']);
  });

  it('rejects a default above the maximum, naming the default', () => {
    const result = schema.safeParse({ APP_QUERY_DEFAULT_LIMIT: '11', APP_QUERY_MAX_LIMIT: '10' });

    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['APP_QUERY_DEFAULT_LIMIT'],
        message: 'must not be above APP_QUERY_MAX_LIMIT',
      }),
    ]);
  });
});
