import { describe, expect, it } from 'vitest';

import { ZodBaseEnvSchema } from './zod-base-env-schema.js';

/** The core variables (environment, log level, port) are tested once in `zod-core-env-schema.test.ts`. */
describe('ZodBaseEnvSchema', () => {
  const base = new ZodBaseEnvSchema({ defaultNodeEnv: 'development', portVariable: 'APP_PORT' });
  const { schema } = base.create();
  const ENV = {
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    REDIS_URL: 'redis://localhost:6379',
    APP_PORT: '3000',
    INTERNAL_SERVICE_TOKEN: 'a-long-random-token',
  };
  const paths = (env: unknown): PropertyKey[][] =>
    schema.safeParse(env).error?.issues.map((issue) => issue.path) ?? [];

  it('reads the core variables plus Redis and the service token into typed settings', () => {
    const { config } = base.toConfig({ env: schema.parse(ENV) });

    expect(config).toEqual({
      nodeEnv: 'production',
      logLevel: 'warn',
      redisUrl: 'redis://localhost:6379',
      port: 3000,
      internalServiceToken: 'a-long-random-token',
    });
  });

  it('passes its params to the core variables', () => {
    const other = new ZodBaseEnvSchema({
      defaultNodeEnv: 'production',
      portVariable: 'OTHER_PORT',
    });
    const { NODE_ENV: _env, APP_PORT: _port, ...rest } = ENV;

    const { config } = other.toConfig({
      env: other.create().schema.parse({ ...rest, OTHER_PORT: '0' }),
    });

    expect(config).toMatchObject({ nodeEnv: 'production', port: 0 });
  });

  it('requires a non-empty service token', () => {
    const { INTERNAL_SERVICE_TOKEN: _token, ...withoutToken } = ENV;

    expect(paths(withoutToken)).toEqual([['INTERNAL_SERVICE_TOKEN']]);
    expect(paths({ ...ENV, INTERNAL_SERVICE_TOKEN: '' })).toEqual([['INTERNAL_SERVICE_TOKEN']]);
  });

  it('accepts a TLS Redis URL', () => {
    expect(schema.parse({ ...ENV, REDIS_URL: 'rediss://cache:6380' }).REDIS_URL).toBe(
      'rediss://cache:6380',
    );
  });

  it('requires a Redis URL of the redis protocol', () => {
    const { REDIS_URL: _url, ...withoutRedis } = ENV;

    expect(paths(withoutRedis)).toEqual([['REDIS_URL']]);
    expect(paths({ ...ENV, REDIS_URL: 'not a url' })).toEqual([['REDIS_URL']]);
    expect(paths({ ...ENV, REDIS_URL: 'http://localhost:6379' })).toEqual([['REDIS_URL']]);
  });
});
