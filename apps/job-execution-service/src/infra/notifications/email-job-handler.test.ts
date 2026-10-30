import { randomUUID } from 'node:crypto';

import type { Job } from '@job-queue/contracts';
import type { Random, Sleeper } from '@job-queue/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { EmailJobHandler } from './email-job-handler.js';

const MESSAGE_ID = randomUUID();
const OTHER_MESSAGE_ID = randomUUID();

const PARAMS = { sendMinMs: 1000, sendMaxMs: 3000 };

const JOB: Job = {
  id: randomUUID(),
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
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

describe('EmailJobHandler', () => {
  let random: DeepMockProxy<Random>;
  let sleeper: DeepMockProxy<Sleeper>;
  let handler: EmailJobHandler;

  beforeEach(() => {
    random = mockDeep<Random>();
    sleeper = mockDeep<Sleeper>();
    handler = new EmailJobHandler({ random, sleeper }, PARAMS);
  });

  it('Email job returns a message id', async () => {
    const signal = new AbortController().signal;
    random.int.mockReturnValueOnce({ value: 1500 }).mockReturnValueOnce({ value: 1500 });
    sleeper.sleep.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    random.uuid
      .mockReturnValueOnce({ value: MESSAGE_ID })
      .mockReturnValueOnce({ value: OTHER_MESSAGE_ID });

    const first = await handler.run({ job: JOB, attempt: 1, signal });
    const second = await handler.run({ job: JOB, attempt: 1, signal });

    expect(first).toEqual({ outcome: 'completed', result: { messageId: MESSAGE_ID } });
    expect(second).toEqual({ outcome: 'completed', result: { messageId: OTHER_MESSAGE_ID } });
  });

  it('Email job takes a configured time', async () => {
    let wake: () => void = () => undefined;
    random.int.mockReturnValueOnce({ value: 2345 });
    sleeper.sleep.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          wake = () => {
            resolve({});
          };
        }),
    );
    random.uuid.mockReturnValueOnce({ value: MESSAGE_ID });
    const signal = new AbortController().signal;
    let finished = false;

    const running = handler.run({ job: JOB, attempt: 1, signal }).then(() => {
      finished = true;
    });
    await Promise.resolve();

    expect(random.int).toHaveBeenCalledWith({ min: PARAMS.sendMinMs, max: PARAMS.sendMaxMs });
    expect(sleeper.sleep).toHaveBeenCalledWith({ ms: 2345, signal });
    expect(finished).toBe(false);
    wake();
    await running;
    expect(finished).toBe(true);
  });
});
