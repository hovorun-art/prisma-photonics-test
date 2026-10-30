import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  INSTANCE_ID,
  JobExecutionServiceUnderTest,
  TEST_CONFIG,
} from './job-execution-service-under-test.js';

const JOB_ID = randomUUID();
const REQUEST_ID = randomUUID();
const ENTRY = { jobId: JOB_ID, run: 1, attempt: 1 };
const AT = { run: 1, attempt: 1 };

/**
 * How a webhook job runs in the app with the configured call time and failure rate; the failure
 * rates 0 and 1, the 5xx set and the request ids are the handler's unit test.
 */
describe('job-execution-service running webhook jobs', () => {
  let service: JobExecutionServiceUnderTest;

  /** job-service has the webhook job pending and accepts its start; the call takes its time. */
  const readAndCall = (): void => {
    service.readAndStart(service.webhookJob({ id: JOB_ID }));
    service.sleeper.sleep.mockResolvedValueOnce({});
  };

  beforeAll(async () => {
    service = await JobExecutionServiceUnderTest.start();
  });
  beforeEach(() => {
    service.clear();
  });
  afterAll(async () => {
    service.stubIdleShutdown();
    await service.close();
  });

  it('Webhook job returns status 200 and a request id', async () => {
    readAndCall();
    // At the configured failure rate, not below it: the call succeeds.
    service.random.next.mockReturnValueOnce({ value: TEST_CONFIG.webhookFailureRate });
    service.random.uuid.mockReturnValueOnce({ value: REQUEST_ID });
    service.acceptsReport(service.webhookJob({ id: JOB_ID, status: 'completed', attempts: 1 }));

    await service.run(ENTRY);

    expect(service.sleeper.sleep).toHaveBeenCalledExactlyOnceWith({
      ms: TEST_CONFIG.webhookCallMs,
      signal: expect.any(AbortSignal) as AbortSignal,
    });
    expect(service.reports()).toEqual([
      { status: 'processing', ...AT },
      {
        status: 'completed',
        result: { statusCode: 200, responseBody: { received: true, requestId: REQUEST_ID } },
        ...AT,
      },
    ]);
  });

  it('Failed webhook attempt is logged as a warning', async () => {
    readAndCall();
    // Just below the configured failure rate: the call fails, with the third 5xx status (503).
    service.random.next.mockReturnValueOnce({ value: TEST_CONFIG.webhookFailureRate - 0.01 });
    service.random.int.mockReturnValueOnce({ value: 2 });
    service.acceptsReport(service.webhookJob({ id: JOB_ID, attempts: 1 }));

    await service.run(ENTRY);

    expect(service.reports()).toEqual([
      { status: 'processing', ...AT },
      {
        status: 'failed',
        error: {
          code: 'WEBHOOK_HTTP_ERROR',
          message: 'Webhook POST https://example.com/hook answered 503',
          details: { statusCode: 503 },
        },
        ...AT,
      },
    ]);
    expect(service.jobLogs(JOB_ID).filter((line) => line.level === 40)).toEqual([
      expect.objectContaining({
        attempt: 1,
        instanceId: INSTANCE_ID,
        code: 'WEBHOOK_HTTP_ERROR',
        details: { statusCode: 503 },
      }),
    ]);
  });
});
