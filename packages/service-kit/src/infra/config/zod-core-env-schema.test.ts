import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodCoreEnvSchema } from './zod-core-env-schema.js';

describe('ZodCoreEnvSchema', () => {
  const core = new ZodCoreEnvSchema({ defaultNodeEnv: 'development', portVariable: 'APP_PORT' });
  const { schema } = core.create();
  const ENV = { NODE_ENV: 'production', LOG_LEVEL: 'warn', APP_PORT: '3002' };

  it('reads the environment, log level and port without Redis or a service token', () => {
    const { config } = core.toConfig({ env: schema.parse(ENV) });

    expect(config).toEqual({ nodeEnv: 'production', logLevel: 'warn', port: 3002 });
  });

  it('defaults the environment from its params and the log level to info', () => {
    const production = new ZodCoreEnvSchema({
      defaultNodeEnv: 'production',
      portVariable: 'APP_PORT',
    }).create().schema;

    expect(schema.parse({ APP_PORT: '0' })).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    });
    expect(production.parse({ APP_PORT: '0' })).toMatchObject({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    });
  });

  it('accepts the silent log level', () => {
    expect(schema.parse({ ...ENV, LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe('silent');
  });

  it('reads the port from the variable named in its params', () => {
    const other = new ZodCoreEnvSchema({ defaultNodeEnv: 'test', portVariable: 'OTHER_PORT' });

    expect(
      other.toConfig({ env: other.create().schema.parse({ OTHER_PORT: '0' }) }).config.port,
    ).toBe(0);
    expect(other.create().schema.safeParse({ APP_PORT: '3002' }).success).toBe(false);
  });

  it('accepts the highest port and rejects a missing, negative, fractional, too high or non-numeric one', () => {
    expect(schema.parse({ APP_PORT: '65535' }).APP_PORT).toBe(65_535);
    for (const port of [undefined, '-1', '3.5', '65536', 'many']) {
      expect(schema.safeParse({ APP_PORT: port }).error?.issues[0]?.path).toEqual(['APP_PORT']);
    }
  });

  it('rejects an unknown environment and an unknown log level, naming the variable', () => {
    expect(schema.safeParse({ ...ENV, NODE_ENV: 'staging' }).error?.issues[0]?.path).toEqual([
      'NODE_ENV',
    ]);
    expect(schema.safeParse({ ...ENV, LOG_LEVEL: 'loud' }).error?.issues[0]?.path).toEqual([
      'LOG_LEVEL',
    ]);
  });

  it('can be extended with an app own variables', () => {
    const extended = schema.extend({ EXTRA: z.coerce.number() });

    expect(extended.parse({ ...ENV, EXTRA: '7' })).toMatchObject({ EXTRA: 7, APP_PORT: 3002 });
    expect(extended.safeParse(ENV).success).toBe(false);
  });
});
