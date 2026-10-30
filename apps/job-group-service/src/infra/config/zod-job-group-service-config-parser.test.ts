import { describe, expect, it } from 'vitest';

import { ZodJobGroupServiceConfigParser } from './zod-job-group-service-config-parser.js';

/** The job-group-service variables of `.env.example`. */
const ENV = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
  JOB_GROUP_SERVICE_PORT: '3002',
  JOB_GROUP_SERVICE_DATABASE_URL:
    'postgresql://jobqueue:jobqueue@localhost:5432/jobqueue?schema=job_groups',
  JOB_SERVICE_URL: 'http://localhost:3000',
};

describe('ZodJobGroupServiceConfigParser', () => {
  const parser = new ZodJobGroupServiceConfigParser();
  const problems = (env: Record<string, string | undefined>): string => {
    const result = parser.parse({ env });
    return result.ok ? '' : result.problems;
  };

  it('reads a valid environment, without Redis or a service token, into typed settings with the defaults', () => {
    expect(parser.parse({ env: ENV })).toEqual({
      ok: true,
      config: {
        nodeEnv: 'production',
        logLevel: 'warn',
        port: 3002,
        databaseUrl: 'postgresql://jobqueue:jobqueue@localhost:5432/jobqueue',
        databaseSchema: 'job_groups',
        jobServiceUrl: 'http://localhost:3000',
        jobServiceTimeoutMs: 5000,
        pollIntervalMs: 2000,
        pollBatchSize: 100,
        queryDefaultLimit: 20,
        queryMaxLimit: 100,
      },
    });
  });

  it('defaults the environment to development', () => {
    const { NODE_ENV: _env, ...withoutNodeEnv } = ENV;

    expect(parser.parse({ env: withoutNodeEnv })).toMatchObject({
      ok: true,
      config: { nodeEnv: 'development' },
    });
  });

  it('reads the configured poll, timeout and paging values', () => {
    const env = {
      ...ENV,
      JOB_GROUP_POLL_INTERVAL_MS: '50',
      JOB_GROUP_POLL_BATCH_SIZE: '7',
      JOB_GROUP_JOB_SERVICE_TIMEOUT_MS: '300',
      JOB_GROUP_QUERY_DEFAULT_LIMIT: '3',
      JOB_GROUP_QUERY_MAX_LIMIT: '10',
    };

    expect(parser.parse({ env })).toMatchObject({
      ok: true,
      config: {
        pollIntervalMs: 50,
        pollBatchSize: 7,
        jobServiceTimeoutMs: 300,
        queryDefaultLimit: 3,
        queryMaxLimit: 10,
      },
    });
  });

  const NUMERIC_VARIABLES = [
    'JOB_GROUP_POLL_INTERVAL_MS',
    'JOB_GROUP_POLL_BATCH_SIZE',
    'JOB_GROUP_JOB_SERVICE_TIMEOUT_MS',
    'JOB_GROUP_QUERY_DEFAULT_LIMIT',
    'JOB_GROUP_QUERY_MAX_LIMIT',
  ];

  it.each(
    NUMERIC_VARIABLES.flatMap((variable) =>
      ['0', '-1', '1.5', 'many'].map((value) => [variable, value]),
    ),
  )('rejects %s=%s, which is not a positive integer', (variable, value) => {
    expect(problems({ ...ENV, [variable]: value })).toContain(variable);
  });

  it('accepts 1 for every numeric variable', () => {
    const env = Object.fromEntries(NUMERIC_VARIABLES.map((variable) => [variable, '1']));

    expect(parser.parse({ env: { ...ENV, ...env } })).toMatchObject({
      ok: true,
      config: {
        pollIntervalMs: 1,
        pollBatchSize: 1,
        jobServiceTimeoutMs: 1,
        queryDefaultLimit: 1,
        queryMaxLimit: 1,
      },
    });
  });

  it('accepts a default page size equal to the maximum', () => {
    const env = { ...ENV, JOB_GROUP_QUERY_DEFAULT_LIMIT: '10', JOB_GROUP_QUERY_MAX_LIMIT: '10' };

    expect(parser.parse({ env })).toMatchObject({
      ok: true,
      config: { queryDefaultLimit: 10, queryMaxLimit: 10 },
    });
  });

  it('rejects a default page size above the maximum', () => {
    const env = { ...ENV, JOB_GROUP_QUERY_DEFAULT_LIMIT: '11', JOB_GROUP_QUERY_MAX_LIMIT: '10' };

    expect(problems(env)).toContain('JOB_GROUP_QUERY_DEFAULT_LIMIT');
  });

  it('requires the database URL with its schema and the job-service URL', () => {
    const { JOB_GROUP_SERVICE_DATABASE_URL: _db, ...withoutDatabase } = ENV;
    const { JOB_SERVICE_URL: _url, ...withoutJobService } = ENV;

    expect(problems(withoutDatabase)).toContain('JOB_GROUP_SERVICE_DATABASE_URL');
    expect(problems(withoutJobService)).toContain('JOB_SERVICE_URL');
    expect(
      problems({
        ...ENV,
        JOB_GROUP_SERVICE_DATABASE_URL: 'postgresql://jobqueue:jobqueue@localhost:5432/jobqueue',
      }),
    ).toContain('JOB_GROUP_SERVICE_DATABASE_URL');
  });

  it('keeps the other parameters of the database URL and takes out only the schema', () => {
    const env = {
      ...ENV,
      JOB_GROUP_SERVICE_DATABASE_URL:
        'postgres://jobqueue:jobqueue@db:5432/jobqueue?schema=job_groups&sslmode=require',
    };

    expect(parser.parse({ env })).toMatchObject({
      ok: true,
      config: {
        databaseUrl: 'postgres://jobqueue:jobqueue@db:5432/jobqueue?sslmode=require',
        databaseSchema: 'job_groups',
      },
    });
  });

  it('rejects an empty schema in the database URL', () => {
    expect(
      problems({
        ...ENV,
        JOB_GROUP_SERVICE_DATABASE_URL:
          'postgresql://jobqueue:jobqueue@localhost:5432/jobqueue?schema=',
      }),
    ).toContain('JOB_GROUP_SERVICE_DATABASE_URL');
  });

  it('accepts an https job-service URL', () => {
    expect(
      parser.parse({ env: { ...ENV, JOB_SERVICE_URL: 'https://jobs.example.com' } }),
    ).toMatchObject({ ok: true, config: { jobServiceUrl: 'https://jobs.example.com' } });
  });

  it('rejects URLs of another protocol', () => {
    expect(
      problems({
        ...ENV,
        JOB_GROUP_SERVICE_DATABASE_URL: 'mysql://localhost/db?schema=job_groups',
      }),
    ).toContain('JOB_GROUP_SERVICE_DATABASE_URL');
    expect(problems({ ...ENV, JOB_SERVICE_URL: 'ftp://localhost:3000' })).toContain(
      'JOB_SERVICE_URL',
    );
  });
});
