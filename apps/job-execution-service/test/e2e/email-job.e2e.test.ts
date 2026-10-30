import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobExecutionServiceUnderTest, TEST_CONFIG } from './job-execution-service-under-test.js';

const JOB_ID = randomUUID();
const MESSAGE_ID = randomUUID();
/** The send time the handler draws, within the configured range. */
const SEND_MS = 150;

/** How an email job runs in the app; its random draws are the handler's unit test. */
describe('job-execution-service running email jobs', () => {
  let service: JobExecutionServiceUnderTest;

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

  it('Email job takes a configured time', async () => {
    service.readAndStart(service.emailJob({ id: JOB_ID }));
    service.sendsEmail({ sendMs: SEND_MS, messageId: MESSAGE_ID });
    service.acceptsReport(service.emailJob({ id: JOB_ID, status: 'completed', attempts: 1 }));

    await service.run({ jobId: JOB_ID, attempt: 1 });

    expect(service.random.int).toHaveBeenCalledExactlyOnceWith({
      min: TEST_CONFIG.emailSendMinMs,
      max: TEST_CONFIG.emailSendMaxMs,
    });
    expect(service.sleeper.sleep).toHaveBeenCalledExactlyOnceWith({
      ms: SEND_MS,
      signal: expect.any(AbortSignal) as AbortSignal,
    });
    expect(service.reports()).toEqual([
      { status: 'processing' },
      { status: 'completed', result: { messageId: MESSAGE_ID } },
    ]);
  });
});
