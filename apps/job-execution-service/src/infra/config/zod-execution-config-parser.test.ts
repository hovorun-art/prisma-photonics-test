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
        jobLogStreamMaxLength: 100000,
        concurrency: 5,
        emailSendMinMs: 1000,
        emailSendMaxMs: 3000,
        webhookCallMs: 1500,
        webhookFailureRate: 0.2,
        flightTransitGenerateMs: 2000,
        flightTransitFailureRate: 0.1,
        flightTransitPathPoints: 64,
        flightTransitCruiseWaypoints: 4,
        flightTransitLongHaulKm: 4000,
        flightTransitClimbKm: 200,
        flightTransitDescentKm: 250,
        flightTransitTaxiSpeedKmh: 30,
        reportRetries: 3,
        reportRetryDelayMs: 500,
        reportRetryMaxDelayMs: 5000,
        jobServiceTimeoutMs: 5000,
        shutdownGraceMs: 10000,
        lockDurationMs: 30000,
        stalledIntervalMs: 30000,
      },
    });
  });

  it('reads the configured queue lock duration and stalled check interval', () => {
    const env = {
      ...ENV,
      JOB_QUEUE_LOCK_DURATION_MS: '2000',
      JOB_QUEUE_STALLED_INTERVAL_MS: '1500',
    };

    expect(parser.parse({ env })).toMatchObject({
      ok: true,
      config: { lockDurationMs: 2000, stalledIntervalMs: 1500 },
    });
  });

  it.each(['0', '-1', '1.5', 'long'])(
    'rejects a lock duration or stalled interval of %s',
    (value) => {
      for (const name of ['JOB_QUEUE_LOCK_DURATION_MS', 'JOB_QUEUE_STALLED_INTERVAL_MS']) {
        const result = parser.parse({ env: { ...ENV, [name]: value } });

        expect(result.ok ? '' : result.problems).toContain(name);
      }
    },
  );

  it('reads the configured execution settings', () => {
    const env = {
      ...ENV,
      JOB_EXECUTION_CONCURRENCY: '2',
      EMAIL_SEND_MIN_MS: '10',
      EMAIL_SEND_MAX_MS: '20',
      WEBHOOK_CALL_MS: '0',
      WEBHOOK_FAILURE_RATE: '1',
      FLIGHT_TRANSIT_GENERATE_MS: '0',
      FLIGHT_TRANSIT_FAILURE_RATE: '1',
      FLIGHT_TRANSIT_PATH_POINTS: '2',
      FLIGHT_TRANSIT_CRUISE_WAYPOINTS: '0',
      FLIGHT_TRANSIT_LONG_HAUL_KM: '5000',
      FLIGHT_TRANSIT_CLIMB_KM: '150',
      FLIGHT_TRANSIT_DESCENT_KM: '180',
      FLIGHT_TRANSIT_TAXI_SPEED_KMH: '20',
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
        webhookCallMs: 0,
        webhookFailureRate: 1,
        flightTransitGenerateMs: 0,
        flightTransitFailureRate: 1,
        flightTransitPathPoints: 2,
        flightTransitCruiseWaypoints: 0,
        flightTransitLongHaulKm: 5000,
        flightTransitClimbKm: 150,
        flightTransitDescentKm: 180,
        flightTransitTaxiSpeedKmh: 20,
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

  it('rejects a webhook failure rate outside 0 to 1 and a negative webhook call time', () => {
    for (const env of [
      { WEBHOOK_FAILURE_RATE: '-0.1' },
      { WEBHOOK_FAILURE_RATE: '1.5' },
      { WEBHOOK_FAILURE_RATE: 'often' },
    ]) {
      const result = parser.parse({ env: { ...ENV, ...env } });

      expect(result.ok ? '' : result.problems).toContain('WEBHOOK_FAILURE_RATE');
    }
    const negativeCall = parser.parse({ env: { ...ENV, WEBHOOK_CALL_MS: '-1' } });
    expect(negativeCall.ok ? '' : negativeCall.problems).toContain('WEBHOOK_CALL_MS');
  });

  it('rejects invalid flight transit settings', () => {
    for (const [name, value] of [
      ['FLIGHT_TRANSIT_FAILURE_RATE', '-0.1'],
      ['FLIGHT_TRANSIT_FAILURE_RATE', '1.5'],
      ['FLIGHT_TRANSIT_FAILURE_RATE', 'often'],
      ['FLIGHT_TRANSIT_GENERATE_MS', '-1'],
      ['FLIGHT_TRANSIT_GENERATE_MS', '1.5'],
      ['FLIGHT_TRANSIT_PATH_POINTS', '1'],
      ['FLIGHT_TRANSIT_PATH_POINTS', '2.5'],
      ['FLIGHT_TRANSIT_CRUISE_WAYPOINTS', '-1'],
      ['FLIGHT_TRANSIT_CRUISE_WAYPOINTS', '2.5'],
      ['FLIGHT_TRANSIT_LONG_HAUL_KM', '0'],
      ['FLIGHT_TRANSIT_CLIMB_KM', '0'],
      ['FLIGHT_TRANSIT_DESCENT_KM', '0'],
      ['FLIGHT_TRANSIT_TAXI_SPEED_KMH', '0'],
    ] as const) {
      const result = parser.parse({ env: { ...ENV, [name]: value } });

      expect(result.ok ? '' : result.problems).toContain(name);
    }
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
