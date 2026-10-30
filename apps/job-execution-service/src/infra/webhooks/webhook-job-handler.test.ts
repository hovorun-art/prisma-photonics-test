import { randomUUID } from 'node:crypto';

import type { WebhookJob } from '@job-queue/contracts';
import type { Random, Sleeper } from '@job-queue/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { WebhookJobHandler } from './webhook-job-handler.js';

const REQUEST_ID = randomUUID();
const OTHER_REQUEST_ID = randomUUID();
const PARAMS = { callMs: 1500, failureRate: 0.2 };

const JOB: WebhookJob = {
  id: randomUUID(),
  type: 'webhook',
  payload: { method: 'POST', url: 'https://example.com/hook', body: { a: 1 } },
  status: 'processing',
  priority: 5,
  attempts: 1,
  maxAttempts: 3,
  result: null,
  error: null,
  scheduledAt: null,
  startedAt: '2026-10-29T12:00:00.000Z',
  completedAt: null,
  createdAt: '2026-10-29T11:00:00.000Z',
  updatedAt: '2026-10-29T12:00:00.000Z',
};

describe('WebhookJobHandler', () => {
  let random: DeepMockProxy<Random>;
  let sleeper: DeepMockProxy<Sleeper>;
  const signal = new AbortController().signal;

  const handler = (failureRate = PARAMS.failureRate): WebhookJobHandler =>
    new WebhookJobHandler({ random, sleeper }, { ...PARAMS, failureRate });

  beforeEach(() => {
    random = mockDeep<Random>();
    sleeper = mockDeep<Sleeper>();
  });

  it('Webhook job takes the configured time', async () => {
    let wake: () => void = () => undefined;
    sleeper.sleep.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          wake = () => {
            resolve({});
          };
        }),
    );
    random.next.mockReturnValueOnce({ value: 0.9 });
    random.uuid.mockReturnValueOnce({ value: REQUEST_ID });

    let finished = false;
    const running = handler()
      .run({ job: JOB, attempt: 1, signal })
      .then(() => {
        finished = true;
      });
    await Promise.resolve();

    expect(sleeper.sleep).toHaveBeenCalledWith({ ms: PARAMS.callMs, signal });
    expect(finished).toBe(false);
    wake();
    await running;
    expect(finished).toBe(true);
  });

  it('Failure rate zero never fails', async () => {
    const neverFails = handler(0);
    // `next()` is in [0, 1): even its lowest value is not below a zero rate.
    for (const value of [0, 0.5, 0.999]) {
      sleeper.sleep.mockResolvedValueOnce({});
      random.next.mockReturnValueOnce({ value });
      random.uuid.mockReturnValueOnce({ value: REQUEST_ID });

      const response = await neverFails.run({ job: JOB, attempt: 1, signal });

      expect(response.outcome).toBe('completed');
    }
  });

  it('Failure rate one always fails', async () => {
    const alwaysFails = handler(1);
    for (const value of [0, 0.5, 0.999]) {
      sleeper.sleep.mockResolvedValueOnce({});
      random.next.mockReturnValueOnce({ value });
      random.int.mockReturnValueOnce({ value: 0 });

      const response = await alwaysFails.run({ job: JOB, attempt: 1, signal });

      expect(response.outcome).toBe('failed');
    }
  });

  it('Webhook job returns status 200 and a request id', async () => {
    const succeeds = handler();
    for (const value of [REQUEST_ID, OTHER_REQUEST_ID]) {
      sleeper.sleep.mockResolvedValueOnce({});
      random.next.mockReturnValueOnce({ value: PARAMS.failureRate });
      random.uuid.mockReturnValueOnce({ value });
    }

    const first = await succeeds.run({ job: JOB, attempt: 1, signal });
    const second = await succeeds.run({ job: JOB, attempt: 1, signal });

    expect(first).toEqual({
      outcome: 'completed',
      result: { statusCode: 200, responseBody: { received: true, requestId: REQUEST_ID } },
    });
    expect(second).toEqual({
      outcome: 'completed',
      result: { statusCode: 200, responseBody: { received: true, requestId: OTHER_REQUEST_ID } },
    });
  });

  it('Failed webhook attempt carries a 5xx status', async () => {
    const fails = handler();
    const statuses = [500, 502, 503, 504];
    for (const [index, statusCode] of statuses.entries()) {
      sleeper.sleep.mockResolvedValueOnce({});
      random.next.mockReturnValueOnce({ value: 0.1 });
      random.int.mockReturnValueOnce({ value: index });

      const response = await fails.run({ job: JOB, attempt: 1, signal });

      expect(random.int).toHaveBeenLastCalledWith({ min: 0, max: statuses.length - 1 });
      expect(response).toEqual({
        outcome: 'failed',
        error: {
          code: 'WEBHOOK_HTTP_ERROR',
          message: `Webhook POST https://example.com/hook answered ${String(statusCode)}`,
          details: { statusCode },
        },
      });
    }
  });
});
