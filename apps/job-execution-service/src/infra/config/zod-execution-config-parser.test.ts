import { describe, expect, it } from 'vitest';

import { ZodExecutionConfigParser } from './zod-execution-config-parser.js';

/** The job-execution-service variables of `.env.example`. */
const ENV = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  REDIS_URL: 'redis://localhost:6379',
  JOB_EXECUTION_SERVICE_PORT: '3001',
};

describe('ZodExecutionConfigParser', () => {
  const parser = new ZodExecutionConfigParser();

  it('reads the environment into typed settings', () => {
    expect(parser.parse({ env: ENV })).toEqual({
      ok: true,
      config: {
        nodeEnv: 'development',
        logLevel: 'info',
        redisUrl: 'redis://localhost:6379',
        port: 3001,
      },
    });
  });

  it('Starts without database settings: accepts an environment with no database settings and ignores them when present', () => {
    const result = parser.parse({ env: { ...ENV, DATABASE_URL: 'postgresql://db/jobs' } });

    expect(parser.parse({ env: ENV }).ok).toBe(true);
    expect(result.ok && JSON.stringify(result.config)).not.toContain('postgresql');
  });

  it('defaults the environment and log level', () => {
    const result = parser.parse({ env: { ...ENV, NODE_ENV: undefined, LOG_LEVEL: undefined } });

    expect(result.ok && [result.config.nodeEnv, result.config.logLevel]).toEqual([
      'production',
      'info',
    ]);
  });

  it('names every missing or invalid variable', () => {
    const result = parser.parse({
      env: { ...ENV, JOB_EXECUTION_SERVICE_PORT: undefined, LOG_LEVEL: 'loud' },
    });

    expect(result.ok).toBe(false);
    const problems = result.ok ? '' : result.problems;
    expect(problems).toContain('JOB_EXECUTION_SERVICE_PORT');
    expect(problems).toContain('LOG_LEVEL');
  });

  it('requires a Redis URL', () => {
    expect(parser.parse({ env: { ...ENV, REDIS_URL: 'http://localhost:6379' } })).toEqual({
      ok: false,
      problems: expect.stringContaining('REDIS_URL') as string,
    });
  });
});
