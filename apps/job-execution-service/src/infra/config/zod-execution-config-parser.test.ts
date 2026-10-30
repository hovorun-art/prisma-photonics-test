import { describe, expect, it } from 'vitest';

import { ZodExecutionConfigParser } from './zod-execution-config-parser.js';

/** The job-execution-service variables of `.env.example`. */
const ENV = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  REDIS_URL: 'redis://localhost:6379',
  JOB_EXECUTION_SERVICE_PORT: '3001',
  JOB_SERVICE_URL: 'http://localhost:3000',
  INTERNAL_SERVICE_TOKEN: 'a-long-random-token',
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
        jobServiceUrl: 'http://localhost:3000',
        internalServiceToken: 'a-long-random-token',
        concurrency: 5,
        emailSendMinMs: 1000,
        emailSendMaxMs: 3000,
        reportRetries: 3,
        reportRetryDelayMs: 500,
        reportRetryMaxDelayMs: 5000,
        jobServiceTimeoutMs: 5000,
        shutdownGraceMs: 10000,
      },
    });
  });

  it('reads the configured execution settings', () => {
    const env = {
      ...ENV,
      JOB_EXECUTION_CONCURRENCY: '2',
      EMAIL_SEND_MIN_MS: '10',
      EMAIL_SEND_MAX_MS: '20',
      JOB_REPORT_RETRIES: '0',
      JOB_REPORT_RETRY_DELAY_MS: '50',
      JOB_REPORT_RETRY_MAX_DELAY_MS: '60',
      JOB_SERVICE_TIMEOUT_MS: '300',
      JOB_EXECUTION_SHUTDOWN_GRACE_MS: '400',
    };

    expect(parser.parse({ env })).toMatchObject({
      ok: true,
      config: {
        concurrency: 2,
        emailSendMinMs: 10,
        emailSendMaxMs: 20,
        reportRetries: 0,
        reportRetryDelayMs: 50,
        reportRetryMaxDelayMs: 60,
        jobServiceTimeoutMs: 300,
        shutdownGraceMs: 400,
      },
    });
  });

  it('requires the job-service URL and the service token', () => {
    const result = parser.parse({
      env: { ...ENV, JOB_SERVICE_URL: undefined, INTERNAL_SERVICE_TOKEN: undefined },
    });

    const problems = result.ok ? '' : result.problems;
    expect(problems).toContain('JOB_SERVICE_URL');
    expect(problems).toContain('INTERNAL_SERVICE_TOKEN');
  });

  it('rejects an email wait whose minimum is above its maximum', () => {
    const result = parser.parse({
      env: { ...ENV, EMAIL_SEND_MIN_MS: '500', EMAIL_SEND_MAX_MS: '100' },
    });

    expect(result.ok ? '' : result.problems).toContain('EMAIL_SEND_MIN_MS');
  });

  it('rejects a retry delay above its maximum', () => {
    const result = parser.parse({
      env: { ...ENV, JOB_REPORT_RETRY_DELAY_MS: '500', JOB_REPORT_RETRY_MAX_DELAY_MS: '100' },
    });

    expect(result.ok ? '' : result.problems).toContain('JOB_REPORT_RETRY_DELAY_MS');
  });

  it('rejects settings that are not positive integers', () => {
    for (const name of [
      'JOB_EXECUTION_CONCURRENCY',
      'EMAIL_SEND_MAX_MS',
      'JOB_SERVICE_TIMEOUT_MS',
      'JOB_EXECUTION_SHUTDOWN_GRACE_MS',
      'JOB_REPORT_RETRY_MAX_DELAY_MS',
    ]) {
      const result = parser.parse({ env: { ...ENV, [name]: '0' } });

      expect(result.ok ? '' : result.problems).toContain(name);
    }
    const negativeRetries = parser.parse({ env: { ...ENV, JOB_REPORT_RETRIES: '-1' } });
    expect(negativeRetries.ok ? '' : negativeRetries.problems).toContain('JOB_REPORT_RETRIES');
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
