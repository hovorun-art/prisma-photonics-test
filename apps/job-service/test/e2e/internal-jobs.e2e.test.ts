import { randomUUID } from 'node:crypto';

import { Job, JOB_LIMITS } from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobQueueUnavailableError } from '../../src/domain/jobs/errors/job-queue-unavailable.error.js';
import { JobServiceUnderTest, TRANSIT_REPORT } from './job-service-under-test.js';

const UNKNOWN_ID = randomUUID();
const ERROR = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };
const EMAIL_JOB = {
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
};
const START = { status: 'processing' };
const FAIL = { status: 'failed', error: ERROR };
const COMPLETE = { status: 'completed', result: { messageId: 'm-1' } };

describe('job-service internal job routes', () => {
  let service: JobServiceUnderTest;

  const expectInvalid = async (response: Response): Promise<void> => {
    await service.errorBody({ response, status: 400, code: 'VALIDATION_FAILED' });
  };

  const expectNotFound = async (response: Response): Promise<void> => {
    await service.errorBody({ response, status: 404, code: 'JOB_NOT_FOUND' });
  };

  /** Two reports sent at once: one wins with 200, the other loses with a 409 naming `status`. */
  const race = async (id: string, body: unknown, status: Job['status']): Promise<Job> => {
    const responses = await Promise.all([
      service.report({ id, body }),
      service.report({ id, body }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    await service.expectConflict({
      response: responses.find((response) => response.status === 409)!,
      status,
    });
    return Job.parse(await responses.find((response) => response.status === 200)!.json());
  };

  beforeAll(async () => {
    service = await JobServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterAll(async () => {
    await service.close();
  });

  describe('read', () => {
    it('Read an existing job', async () => {
      const job = await service.seed({ status: 'pending' });

      const response = await service.read({ id: job.id });

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toEqual(job);
    });

    it('Read an unknown job', async () => {
      await expectNotFound(await service.read({ id: UNKNOWN_ID }));
    });

    it('Read with a malformed id', async () => {
      expect(await service.issuePaths(await service.read({ id: 'abc' }))).toContainEqual(['id']);
    });
  });

  describe('update', () => {
    it('Unknown target status', async () => {
      const body = { status: 'cancelled' };
      const job = await service.seed({ status: 'pending' });

      await expectInvalid(await service.report({ id: job.id, body }));
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Result does not match the job type', async () => {
      const result = { statusCode: 200, responseBody: {} };
      const job = await service.seed({ status: 'processing' });

      await expectInvalid(
        await service.report({ id: job.id, body: { status: 'completed', result } }),
      );
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Report with a malformed body', async () => {
      const body = '{"status": ';
      const job = await service.seed({ status: 'processing' });

      await expectInvalid(await service.report({ id: job.id, body }));
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Report for an unknown job', async () => {
      await expectNotFound(await service.report({ id: UNKNOWN_ID, body: START }));
    });

    it('Report with a malformed id', async () => {
      const response = await service.report({ id: 'abc', body: START });

      expect(await service.issuePaths(response)).toContainEqual(['id']);
    });

    it('Start a pending job', async () => {
      const job = await service.seed({ status: 'pending', attempts: 0 });

      const response = await service.report({ id: job.id, body: START });

      expect(response.status).toBe(200);
      const started = Job.parse(await response.json());
      expect(started).toMatchObject({ status: 'processing', attempts: 1 });
      expect(started.startedAt).toEqual(expect.any(String));
      expect(await service.stored(job.id)).toEqual(started);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it('Start a scheduled job', async () => {
      const job = await service.seed({ status: 'scheduled' });

      const response = await service.report({ id: job.id, body: START });

      expect(response.status).toBe(200);
      const started = Job.parse(await response.json());
      expect(started).toMatchObject({
        status: 'processing',
        attempts: 1,
        scheduledAt: job.scheduledAt,
      });
      expect(started.startedAt).toEqual(expect.any(String));
      expect(await service.stored(job.id)).toEqual(started);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it('Start a job that is not pending', async () => {
      const status = 'completed';
      const job = await service.seed({ status });

      await service.expectConflict({
        response: await service.report({ id: job.id, body: START }),
        status,
      });
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Two workers start the same job', async () => {
      const job = await service.seed({ status: 'pending', attempts: 0 });

      await race(job.id, START, 'processing');

      expect((await service.stored(job.id)).attempts).toBe(1);
    });

    it('Two workers start the same scheduled job', async () => {
      const job = await service.seed({ status: 'scheduled' });

      await race(job.id, START, 'processing');

      expect(await service.stored(job.id)).toMatchObject({
        status: 'processing',
        attempts: 1,
        scheduledAt: job.scheduledAt,
      });
    });

    it('Complete a processing job', async () => {
      const job = await service.seed({ status: 'processing' });

      const response = await service.report({ id: job.id, body: COMPLETE });

      expect(response.status).toBe(200);
      const completed = Job.parse(await response.json());
      expect(completed).toMatchObject({
        status: 'completed',
        result: COMPLETE.result,
        attempts: job.attempts,
      });
      expect(completed.completedAt).toEqual(expect.any(String));
      expect(await service.stored(job.id)).toEqual(completed);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it('Complete a job that is not processing', async () => {
      const status = 'pending';
      const job = await service.seed({ status });

      await service.expectConflict({
        response: await service.report({ id: job.id, body: COMPLETE }),
        status,
      });
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Two workers complete the same job', async () => {
      const job = await service.seed({ status: 'processing' });

      const winner = await race(job.id, COMPLETE, 'completed');

      expect(await service.stored(job.id)).toEqual(winner);
    });

    it('Failure with attempts left', async () => {
      const job = await service.seed({ status: 'processing', attempts: 1, maxAttempts: 3 });

      const response = await service.report({ id: job.id, body: FAIL });

      expect(response.status).toBe(200);
      const failed = Job.parse(await response.json());
      expect(failed).toMatchObject({
        status: 'pending',
        attempts: 1,
        error: ERROR,
        completedAt: null,
      });
      expect(await service.stored(job.id)).toEqual(failed);
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 2,
        priority: job.priority,
        runAt: null,
      });
    });

    it('A completion and a failure race on the same job', async () => {
      const job = await service.seed({ status: 'processing', attempts: 1, maxAttempts: 3 });

      const responses = await Promise.all([
        service.report({ id: job.id, body: COMPLETE }),
        service.report({ id: job.id, body: FAIL }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const winner = Job.parse(await responses.find((response) => response.status === 200)!.json());
      expect(await service.stored(job.id)).toEqual(winner);
      if (winner.status === 'completed') {
        expect(service.queue.enqueue).not.toHaveBeenCalled();
      } else {
        expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
          jobId: job.id,
          run: 1,
          attempt: 2,
          priority: job.priority,
          runAt: null,
        });
      }
    });

    it('Two workers fail the same job', async () => {
      const job = await service.seed({ status: 'processing', attempts: 1, maxAttempts: 3 });

      await race(job.id, FAIL, 'pending');

      expect(await service.stored(job.id)).toMatchObject({
        status: 'pending',
        attempts: 1,
        error: ERROR,
      });
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 2,
        priority: job.priority,
        runAt: null,
      });
    });

    it('Retry survives an unavailable queue', async () => {
      const job = await service.seed({ status: 'processing', attempts: 1, maxAttempts: 3 });
      service.queue.enqueue.mockImplementationOnce(({ jobId, run, attempt }) =>
        Promise.reject(new JobQueueUnavailableError({ jobId, run, attempt })),
      );

      const response = await service.report({ id: job.id, body: FAIL });

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toMatchObject({ status: 'pending', error: ERROR });
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 2,
        priority: job.priority,
        runAt: null,
      });
      expect(await service.stored(job.id)).toMatchObject({
        status: 'pending',
        attempts: 1,
        error: ERROR,
      });
    });

    it('Completing a retried job clears the earlier error', async () => {
      const job = await service.seed({ status: 'processing', attempts: 1, maxAttempts: 3 });
      expect((await service.report({ id: job.id, body: FAIL })).status).toBe(200);
      expect((await service.report({ id: job.id, body: START })).status).toBe(200);

      const response = await service.report({ id: job.id, body: COMPLETE });

      expect(response.status).toBe(200);
      expect(await service.stored(job.id)).toMatchObject({
        status: 'completed',
        attempts: 2,
        result: COMPLETE.result,
        error: null,
      });
    });

    it('Retries count attempts through the routes', async () => {
      // A scheduled, high-priority job: the retry keeps its priority and runs at once.
      const scheduledAt = new Date(Date.now() + 60_000).toISOString();
      const job = await service.submitted({
        ...EMAIL_JOB,
        maxAttempts: 2,
        priority: JOB_LIMITS.priority.max,
        scheduledAt,
      });

      expect((await service.report({ id: job.id, body: START })).status).toBe(200);
      expect((await service.report({ id: job.id, body: FAIL })).status).toBe(200);
      const retried = Job.parse(await (await service.report({ id: job.id, body: START })).json());
      const failed = Job.parse(await (await service.report({ id: job.id, body: FAIL })).json());

      expect(retried).toMatchObject({ status: 'processing', attempts: 2 });
      expect(failed).toMatchObject({ status: 'failed', attempts: 2, maxAttempts: 2 });
      expect(service.queue.enqueue.mock.calls.map(([entry]) => entry)).toEqual([
        {
          jobId: job.id,
          run: 1,
          attempt: 1,
          priority: JOB_LIMITS.priority.max,
          runAt: scheduledAt,
        },
        { jobId: job.id, run: 1, attempt: 2, priority: JOB_LIMITS.priority.max, runAt: null },
      ]);
    });

    it('Fail a job that is not processing', async () => {
      const status = 'completed';
      const job = await service.seed({ status });

      await service.expectConflict({
        response: await service.report({ id: job.id, body: FAIL }),
        status,
      });
      expect(await service.stored(job.id)).toEqual(job);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      ['the last of several', 3],
      ['the only one', 1],
    ])('Failure on the last attempt (%s)', async (_case, maxAttempts) => {
      const job = await service.seed({ status: 'processing', attempts: maxAttempts, maxAttempts });

      const response = await service.report({ id: job.id, body: FAIL });

      expect(response.status).toBe(200);
      const failed = Job.parse(await response.json());
      expect(failed).toMatchObject({ status: 'failed', attempts: maxAttempts, error: ERROR });
      expect(failed.completedAt).toEqual(expect.any(String));
      expect(await service.stored(job.id)).toEqual(failed);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('reports for a cancelled job', () => {
    /** A job a client cancelled through the public route while it was in `status`. */
    const cancelledWhile = async (status: 'pending' | 'processing'): Promise<Job> => {
      service.queue.cancel.mockResolvedValueOnce({});
      const job = await service.seed({ status });
      expect(
        (await service.changeStatus({ id: job.id, body: { status: 'cancelled' } })).status,
      ).toBe(200);
      return service.stored(job.id);
    };

    it('Completion reported after a cancel', async () => {
      const job = await cancelledWhile('processing');

      const response = await service.report({ id: job.id, body: COMPLETE });

      await service.expectConflict({ response, status: 'cancelled' });
      expect(await service.stored(job.id)).toEqual(job);
      expect(job.result).toBeNull();
    });

    it('Failure reported after a cancel', async () => {
      const job = await cancelledWhile('processing');

      const response = await service.report({ id: job.id, body: FAIL });

      await service.expectConflict({ response, status: 'cancelled' });
      expect(await service.stored(job.id)).toEqual(job);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it('Start reported for a cancelled job', async () => {
      const job = await cancelledWhile('pending');

      const response = await service.report({ id: job.id, body: START });

      await service.expectConflict({ response, status: 'cancelled' });
      expect(await service.stored(job.id)).toEqual(job);
      expect(job.attempts).toBe(0);
    });
  });

  describe('webhook results', () => {
    it('Webhook result is stored', async () => {
      const job = await service.seed({ status: 'processing', type: 'webhook' });
      const result = { statusCode: 200, responseBody: { received: true } };

      const response = await service.report({ id: job.id, body: { status: 'completed', result } });

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toMatchObject({ status: 'completed', result });
      expect(Job.parse(await (await service.get(job.id)).json()).result).toEqual(result);
    });

    it.each([
      ['a 5xx status code', { statusCode: 503, responseBody: {} }],
      ['an email result', { messageId: 'm-1' }],
    ])('Webhook result does not match (%s)', async (_case, result) => {
      const job = await service.seed({ status: 'processing', type: 'webhook' });

      await expectInvalid(
        await service.report({ id: job.id, body: { status: 'completed', result } }),
      );
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Failed webhook error is returned with its status code', async () => {
      const job = await service.seed({
        status: 'processing',
        type: 'webhook',
        attempts: 3,
        maxAttempts: 3,
      });
      const error = {
        code: 'WEBHOOK_HTTP_ERROR',
        message: 'HTTP 503 Service Unavailable',
        details: { statusCode: 503 },
      };

      const response = await service.report({ id: job.id, body: { status: 'failed', error } });

      expect(response.status).toBe(200);
      expect(Job.parse(await (await service.get(job.id)).json())).toMatchObject({
        status: 'failed',
        attempts: 3,
        maxAttempts: 3,
        error,
      });
    });
  });

  describe('flight transit results', () => {
    it('Transit report is stored', async () => {
      const job = await service.seed({ status: 'processing', type: 'flight-transit' });
      const body = { status: 'completed', result: TRANSIT_REPORT };

      const response = await service.report({ id: job.id, body });

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toMatchObject({
        status: 'completed',
        result: TRANSIT_REPORT,
      });
      expect(Job.parse(await (await service.get(job.id)).json()).result).toEqual(TRANSIT_REPORT);
    });

    it('Report for other airports than the payload is stored', async () => {
      const job = await service.seed({ status: 'processing', type: 'flight-transit' });
      const result = { ...TRANSIT_REPORT, origin: { ...TRANSIT_REPORT.origin, iata: 'CDG' } };

      const response = await service.report({ id: job.id, body: { status: 'completed', result } });

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toMatchObject({ status: 'completed', result });
      expect(Job.parse(await (await service.get(job.id)).json()).result).toEqual(result);
    });

    const { aircraft: _aircraft, ...withoutAircraft } = TRANSIT_REPORT;
    it.each([
      ['no aircraft', withoutAircraft, ['result', 'aircraft']],
      ['a webhook result', { statusCode: 200, responseBody: {} }, ['result', 'flight']],
    ])('Transit report does not match (%s)', async (_case, result, path) => {
      const job = await service.seed({ status: 'processing', type: 'flight-transit' });

      const response = await service.report({ id: job.id, body: { status: 'completed', result } });

      expect(await service.issuePaths(response)).toContainEqual(path);
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Failed transit error is returned as sent', async () => {
      const job = await service.seed({
        status: 'processing',
        type: 'flight-transit',
        attempts: 3,
        maxAttempts: 3,
      });
      const error = {
        code: 'TRANSIT_GENERATION_FAILED',
        message: 'No route between the airports',
        details: { origin: 'LHR', destination: 'JFK' },
      };

      const response = await service.report({ id: job.id, body: { status: 'failed', error } });

      expect(response.status).toBe(200);
      expect(Job.parse(await (await service.get(job.id)).json())).toMatchObject({
        status: 'failed',
        attempts: 3,
        maxAttempts: 3,
        error,
      });
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });
  });
});
