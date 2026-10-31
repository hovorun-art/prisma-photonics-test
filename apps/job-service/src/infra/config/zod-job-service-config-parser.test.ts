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
  CLICKHOUSE_URL: 'http://jobqueue:jobqueue@localhost:8123/jobqueue',
};

/** The job log variables with a value for each, and the setting each one becomes. */
const JOB_LOG_SETTINGS = [
  { name: 'JOB_LOG_RETENTION_DAYS', value: '7', setting: 'jobLogRetentionDays' },
  { name: 'JOB_LOG_QUERY_DEFAULT_LIMIT', value: '50', setting: 'jobLogQueryDefaultLimit' },
  { name: 'JOB_LOG_QUERY_MAX_LIMIT', value: '500', setting: 'jobLogQueryMaxLimit' },
  { name: 'JOB_LOG_BATCH_SIZE', value: '200', setting: 'jobLogBatchSize' },
  { name: 'JOB_LOG_FLUSH_INTERVAL_MS', value: '250', setting: 'jobLogFlushIntervalMs' },
  { name: 'JOB_LOG_STORE_RETRY_DELAY_MS', value: '100', setting: 'jobLogStoreRetryDelayMs' },
  {
    name: 'JOB_LOG_STORE_RETRY_MAX_DELAY_MS',
    value: '5000',
    setting: 'jobLogStoreRetryMaxDelayMs',
  },
  { name: 'JOB_LOG_WRITER_LEASE_MS', value: '10000', setting: 'jobLogWriterLeaseMs' },
] as const;

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
        statsRecentWindowMinutes: 1440,
        statsThroughputWindowMinutes: 5,
        retryDelay: { minMs: 5000, maxMs: 30000, capMs: 300000 },
        recovery: { intervalMs: 30000, minAgeMs: 30000, batchSize: 100 },
        maxProcessingMs: { email: 30000, webhook: 30000, 'flight-transit': 60000 },
        jobLogStreamMaxLength: 100000,
        clickhouseUrl: 'http://jobqueue:jobqueue@localhost:8123/jobqueue',
        jobLogRetentionDays: 30,
        jobLogQueryDefaultLimit: 100,
        jobLogQueryMaxLimit: 1000,
        jobLogBatchSize: 1000,
        jobLogFlushIntervalMs: 1000,
        jobLogStoreRetryDelayMs: 500,
        jobLogStoreRetryMaxDelayMs: 30000,
        jobLogWriterLeaseMs: 60000,
      },
    });
  });

  it('reads the configured retry delays, recovery settings and maximum processing times', () => {
    const env = {
      ...ENV,
      JOB_SERVICE_RETRY_MIN_DELAY_MS: '500',
      JOB_SERVICE_RETRY_MAX_DELAY_MS: '1000',
      JOB_SERVICE_RETRY_CAP_DELAY_MS: '3000',
      JOB_SERVICE_RECOVERY_INTERVAL_MS: '2000',
      JOB_SERVICE_RECOVERY_MIN_AGE_MS: '1500',
      JOB_SERVICE_RECOVERY_BATCH_SIZE: '10',
      JOB_SERVICE_MAX_PROCESSING_MS_EMAIL: '100',
      JOB_SERVICE_MAX_PROCESSING_MS_WEBHOOK: '200',
      JOB_SERVICE_MAX_PROCESSING_MS_FLIGHT_TRANSIT: '300',
    };

    expect(parser.parse({ env })).toMatchObject({
      ok: true,
      config: {
        retryDelay: { minMs: 500, maxMs: 1000, capMs: 3000 },
        recovery: { intervalMs: 2000, minAgeMs: 1500, batchSize: 10 },
        maxProcessingMs: { email: 100, webhook: 200, 'flight-transit': 300 },
      },
    });
  });

  it('accepts retry delays that are all equal', () => {
    const env = {
      ...ENV,
      JOB_SERVICE_RETRY_MIN_DELAY_MS: '1000',
      JOB_SERVICE_RETRY_MAX_DELAY_MS: '1000',
      JOB_SERVICE_RETRY_CAP_DELAY_MS: '1000',
    };

    expect(parser.parse({ env }).ok).toBe(true);
  });

  it('rejects a first-retry minimum above its maximum, and a maximum above the cap', () => {
    const minAboveMax = parser.parse({
      env: { ...ENV, JOB_SERVICE_RETRY_MIN_DELAY_MS: '40000' },
    });
    const maxAboveCap = parser.parse({
      env: { ...ENV, JOB_SERVICE_RETRY_CAP_DELAY_MS: '20000' },
    });

    expect(minAboveMax.ok ? '' : minAboveMax.problems).toContain('JOB_SERVICE_RETRY_MIN_DELAY_MS');
    expect(maxAboveCap.ok ? '' : maxAboveCap.problems).toContain('JOB_SERVICE_RETRY_MAX_DELAY_MS');
  });

  it.each(['0', '-1', '1.5', 'often'])(
    'rejects a retry, recovery or processing time setting of %s',
    (value) => {
      for (const name of [
        'JOB_SERVICE_RETRY_MIN_DELAY_MS',
        'JOB_SERVICE_RETRY_MAX_DELAY_MS',
        'JOB_SERVICE_RETRY_CAP_DELAY_MS',
        'JOB_SERVICE_RECOVERY_INTERVAL_MS',
        'JOB_SERVICE_RECOVERY_MIN_AGE_MS',
        'JOB_SERVICE_RECOVERY_BATCH_SIZE',
        'JOB_SERVICE_MAX_PROCESSING_MS_EMAIL',
        'JOB_SERVICE_MAX_PROCESSING_MS_WEBHOOK',
        'JOB_SERVICE_MAX_PROCESSING_MS_FLIGHT_TRANSIT',
      ]) {
        const result = parser.parse({ env: { ...ENV, [name]: value } });

        expect(result.ok ? '' : result.problems).toContain(name);
      }
    },
  );

  it('reads the configured job log settings', () => {
    const env = Object.fromEntries(JOB_LOG_SETTINGS.map(({ name, value }) => [name, value]));
    const expected = Object.fromEntries(
      JOB_LOG_SETTINGS.map(({ setting, value }) => [setting, Number(value)]),
    );

    expect(parser.parse({ env: { ...ENV, ...env } })).toMatchObject({ ok: true, config: expected });
  });

  it.each(
    JOB_LOG_SETTINGS.flatMap(({ name }) =>
      ['0', '-1', '1.5', 'many'].map((value) => ({ name, value })),
    ),
  )('rejects $name=$value', ({ name, value }) => {
    const result = parser.parse({ env: { ...ENV, [name]: value } });

    // The field's own line, not a pair check that only names it.
    expect(result.ok ? '' : result.problems).toContain(`→ at ${name}`);
  });

  it.each([
    {
      name: 'JOB_LOG_QUERY_DEFAULT_LIMIT',
      env: { JOB_LOG_QUERY_DEFAULT_LIMIT: '200', JOB_LOG_QUERY_MAX_LIMIT: '100' },
    },
    {
      name: 'JOB_LOG_STORE_RETRY_DELAY_MS',
      env: { JOB_LOG_STORE_RETRY_DELAY_MS: '2000', JOB_LOG_STORE_RETRY_MAX_DELAY_MS: '1000' },
    },
    {
      name: 'JOB_LOG_WRITER_LEASE_MS',
      env: { JOB_LOG_WRITER_LEASE_MS: '30000', JOB_LOG_STORE_RETRY_MAX_DELAY_MS: '30000' },
    },
  ])('rejects $name out of order with its pair', ({ name, env }) => {
    const result = parser.parse({ env: { ...ENV, ...env } });

    expect(result.ok ? '' : result.problems).toContain(name);
  });

  it.each([
    {
      name: 'JOB_LOG_QUERY_DEFAULT_LIMIT equal to JOB_LOG_QUERY_MAX_LIMIT',
      env: { JOB_LOG_QUERY_DEFAULT_LIMIT: '100', JOB_LOG_QUERY_MAX_LIMIT: '100' },
    },
    {
      name: 'JOB_LOG_STORE_RETRY_DELAY_MS equal to JOB_LOG_STORE_RETRY_MAX_DELAY_MS',
      env: { JOB_LOG_STORE_RETRY_DELAY_MS: '1000', JOB_LOG_STORE_RETRY_MAX_DELAY_MS: '1000' },
    },
    {
      name: 'JOB_LOG_WRITER_LEASE_MS just above JOB_LOG_STORE_RETRY_MAX_DELAY_MS',
      env: { JOB_LOG_WRITER_LEASE_MS: '30001', JOB_LOG_STORE_RETRY_MAX_DELAY_MS: '30000' },
    },
  ])('accepts $name', ({ env }) => {
    expect(parser.parse({ env: { ...ENV, ...env } }).ok).toBe(true);
  });

  it('accepts an https CLICKHOUSE_URL', () => {
    const url = 'https://jobqueue:secret@clickhouse.example.com:8443/jobqueue';

    expect(parser.parse({ env: { ...ENV, CLICKHOUSE_URL: url } })).toMatchObject({
      ok: true,
      config: { clickhouseUrl: url },
    });
  });

  it.each([undefined, 'postgresql://localhost:5432/jobqueue', 'not a url'])(
    'requires an http or https CLICKHOUSE_URL: %s',
    (value) => {
      const result = parser.parse({ env: { ...ENV, CLICKHOUSE_URL: value } });

      expect(result.ok ? '' : result.problems).toContain('CLICKHOUSE_URL');
    },
  );

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
  it('reads the configured statistics windows', () => {
    const env = {
      ...ENV,
      JOB_SERVICE_STATS_RECENT_WINDOW_MINUTES: '60',
      JOB_SERVICE_STATS_THROUGHPUT_WINDOW_MINUTES: '1',
    };

    expect(parser.parse({ env })).toMatchObject({
      ok: true,
      config: { statsRecentWindowMinutes: 60, statsThroughputWindowMinutes: 1 },
    });
  });

  it.each(['0', '-5', '1.5', 'many'])('rejects a statistics window of %s', (value) => {
    for (const name of [
      'JOB_SERVICE_STATS_RECENT_WINDOW_MINUTES',
      'JOB_SERVICE_STATS_THROUGHPUT_WINDOW_MINUTES',
    ]) {
      const result = parser.parse({ env: { ...ENV, [name]: value } });

      expect(result.ok ? '' : result.problems).toContain(name);
    }
  });

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
