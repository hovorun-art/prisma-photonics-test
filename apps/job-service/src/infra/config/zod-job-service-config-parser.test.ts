import { describe, expect, it } from 'vitest';

import { ZodJobServiceConfigParser } from './zod-job-service-config-parser.js';

/** The job-service variables of `.env.example`. */
const ENV = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
  JOB_SERVICE_PORT: '3000',
  DATABASE_URL: 'postgresql://jobqueue:jobqueue@localhost:5432/jobqueue',
  REDIS_URL: 'redis://localhost:6379',
  INTERNAL_SERVICE_TOKEN: 'a-long-random-token',
};

describe('ZodJobServiceConfigParser', () => {
  const parser = new ZodJobServiceConfigParser();

  it('reads a valid environment into typed settings', () => {
    expect(parser.parse({ env: ENV })).toEqual({
      ok: true,
      config: {
        nodeEnv: 'production',
        logLevel: 'warn',
        port: 3000,
        bodyLimitBytes: 1048576,
        databaseUrl: 'postgresql://jobqueue:jobqueue@localhost:5432/jobqueue',
        redisUrl: 'redis://localhost:6379',
        internalServiceToken: 'a-long-random-token',
        queryDefaultLimit: 20,
        queryMaxLimit: 100,
        enqueueTimeoutMs: 2000,
        bulkMaxJobs: 100,
      },
    });
  });

  it('reads the configured maximum of jobs per bulk', () => {
    expect(parser.parse({ env: { ...ENV, JOB_SERVICE_BULK_MAX_JOBS: '25' } })).toMatchObject({
      ok: true,
      config: { bulkMaxJobs: 25 },
    });
  });

  it.each(['0', '-1', '1.5', 'many'])(
    'rejects a maximum of jobs per bulk that is not a positive integer: %s',
    (value) => {
      const result = parser.parse({ env: { ...ENV, JOB_SERVICE_BULK_MAX_JOBS: value } });

      expect(result.ok ? '' : result.problems).toContain('JOB_SERVICE_BULK_MAX_JOBS');
    },
  );

  it('reads the configured query page sizes and enqueue timeout', () => {
    const env = {
      ...ENV,
      JOB_SERVICE_QUERY_DEFAULT_LIMIT: '10',
      JOB_SERVICE_QUERY_MAX_LIMIT: '50',
      JOB_SERVICE_ENQUEUE_TIMEOUT_MS: '500',
    };

    expect(parser.parse({ env })).toMatchObject({
      ok: true,
      config: { queryDefaultLimit: 10, queryMaxLimit: 50, enqueueTimeoutMs: 500 },
    });
  });

  it('rejects a default page size above the maximum page size', () => {
    const result = parser.parse({
      env: { ...ENV, JOB_SERVICE_QUERY_DEFAULT_LIMIT: '200', JOB_SERVICE_QUERY_MAX_LIMIT: '100' },
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problems).toContain('JOB_SERVICE_QUERY_DEFAULT_LIMIT');
  });

  it('rejects a query page size or enqueue timeout that is not a positive number', () => {
    for (const name of [
      'JOB_SERVICE_QUERY_DEFAULT_LIMIT',
      'JOB_SERVICE_QUERY_MAX_LIMIT',
      'JOB_SERVICE_ENQUEUE_TIMEOUT_MS',
    ]) {
      const result = parser.parse({ env: { ...ENV, [name]: '0' } });

      expect(result.ok ? '' : result.problems).toContain(name);
    }
  });

  it('defaults the environment to development and the log level to info', () => {
    const result = parser.parse({ env: { ...ENV, NODE_ENV: undefined, LOG_LEVEL: undefined } });

    expect(result).toMatchObject({
      ok: true,
      config: { nodeEnv: 'development', logLevel: 'info' },
    });
  });

  it('reads the configured body limit', () => {
    expect(parser.parse({ env: { ...ENV, JOB_SERVICE_BODY_LIMIT_BYTES: '2048' } })).toMatchObject({
      ok: true,
      config: { bodyLimitBytes: 2048 },
    });
  });

  it('rejects a body limit that is not a positive number', () => {
    const result = parser.parse({ env: { ...ENV, JOB_SERVICE_BODY_LIMIT_BYTES: '0' } });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problems).toContain('JOB_SERVICE_BODY_LIMIT_BYTES');
  });

  it('names every missing or invalid variable', () => {
    const result = parser.parse({
      env: { ...ENV, DATABASE_URL: undefined, JOB_SERVICE_PORT: 'many', LOG_LEVEL: 'loud' },
    });

    expect(result.ok).toBe(false);
    const problems = result.ok ? '' : result.problems;
    expect(problems).toContain('DATABASE_URL');
    expect(problems).toContain('JOB_SERVICE_PORT');
    expect(problems).toContain('LOG_LEVEL');
  });

  it('requires the service token, so internal routes are never open to a missing token', () => {
    expect(parser.parse({ env: { ...ENV, INTERNAL_SERVICE_TOKEN: undefined } })).toEqual({
      ok: false,
      problems: expect.stringContaining('INTERNAL_SERVICE_TOKEN') as string,
    });
  });

  it('rejects an empty service token without echoing a token value', () => {
    const result = parser.parse({ env: { ...ENV, INTERNAL_SERVICE_TOKEN: '' } });

    expect(result).toEqual({
      ok: false,
      problems: expect.stringContaining('INTERNAL_SERVICE_TOKEN') as string,
    });
    expect(JSON.stringify(parser.parse({ env: { ...ENV, DATABASE_URL: 'x' } }))).not.toContain(
      ENV.INTERNAL_SERVICE_TOKEN,
    );
  });
});
