import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodBaseEnvSchema } from './zod-base-env-schema.js';

describe('ZodBaseEnvSchema', () => {
  const base = new ZodBaseEnvSchema({ defaultNodeEnv: 'development', portVariable: 'APP_PORT' });
  const { schema } = base.create();
  const ENV = {
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    REDIS_URL: 'redis://localhost:6379',
    APP_PORT: '3000',
  };

  it('reads the shared variables into typed settings', () => {
    const { config } = base.toConfig({ env: schema.parse(ENV) });

    expect(config).toEqual({
      nodeEnv: 'production',
      logLevel: 'warn',
      redisUrl: 'redis://localhost:6379',
      port: 3000,
    });
  });

  it('defaults the environment from its params and the log level to info', () => {
    const production = new ZodBaseEnvSchema({
      defaultNodeEnv: 'production',
      portVariable: 'APP_PORT',
    }).create().schema;
    const env = { REDIS_URL: ENV.REDIS_URL, APP_PORT: ENV.APP_PORT };

    expect(schema.parse(env)).toMatchObject({ NODE_ENV: 'development', LOG_LEVEL: 'info' });
    expect(production.parse(env)).toMatchObject({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
  });

  it('accepts the silent log level', () => {
    expect(schema.parse({ ...ENV, LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe('silent');
  });

  it('rejects an unknown environment, an unknown log level and a Redis URL of another protocol', () => {
    expect(schema.safeParse({ ...ENV, NODE_ENV: 'staging' }).success).toBe(false);
    expect(schema.safeParse({ ...ENV, LOG_LEVEL: 'loud' }).success).toBe(false);
    expect(schema.safeParse({ ...ENV, REDIS_URL: 'http://localhost:6379' }).success).toBe(false);
    expect(schema.safeParse({ NODE_ENV: 'test' }).success).toBe(false);
  });

  it('reads the port from the variable named in its params and rejects an invalid one', () => {
    const other = new ZodBaseEnvSchema({ defaultNodeEnv: 'test', portVariable: 'OTHER_PORT' });
    const env = { REDIS_URL: ENV.REDIS_URL, OTHER_PORT: '0' };

    expect(other.toConfig({ env: other.create().schema.parse(env) }).config.port).toBe(0);
    expect(schema.safeParse({ ...ENV, APP_PORT: 'many' }).success).toBe(false);
    expect(schema.safeParse({ ...ENV, APP_PORT: '70000' }).success).toBe(false);
    expect(schema.safeParse({ REDIS_URL: ENV.REDIS_URL }).success).toBe(false);
  });

  it('can be extended with an app own variables', () => {
    const extended = schema.extend({ EXTRA: z.coerce.number() });

    expect(extended.parse({ ...ENV, EXTRA: '7' })).toMatchObject({
      EXTRA: 7,
      NODE_ENV: 'production',
    });
    expect(extended.safeParse(ENV).success).toBe(false);
  });
});
