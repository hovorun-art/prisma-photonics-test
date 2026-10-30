import { randomUUID } from 'node:crypto';

import type { EmailJob, FlightTransitJob, WebhookJob } from '@job-queue/contracts';
import { DomainError, JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { InvalidJobError } from '../../domain/jobs/errors/invalid-job.error.js';
import { JobServiceUnavailableError } from '../../domain/jobs/errors/job-service-unavailable.error.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';
import type { JobHandler } from '../../domain/execution/job-handler.js';
import { JobExecutionImpl } from './job-execution.impl.js';

const JOB_ID = randomUUID();
const ENTRY = { jobId: JOB_ID, attempt: 1 };
const PARAMS = { reportRetries: 2, reportRetryDelayMs: 100, reportRetryMaxDelayMs: 150 };
const RESULT = { messageId: 'm-1' };

class SendRefusedError extends DomainError<'VALIDATION_FAILED'> {
  constructor() {
    super({ code: 'VALIDATION_FAILED', message: 'Mailbox refused the message' });
  }
}

describe('JobExecutionImpl', () => {
  let jobs: DeepMockProxy<JobRepository>;
  let email: DeepMockProxy<JobHandler>;
  let logger: DeepMockProxy<Pick<LoggerService, 'log' | 'warn' | 'error'>>;
  let execution: JobExecutionImpl;

  const job = (overrides: Partial<EmailJob> = {}): EmailJob => ({
    id: JOB_ID,
    type: 'email',
    payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
    status: 'pending',
    priority: 5,
    attempts: 0,
    maxAttempts: 3,
    result: null,
    error: null,
    groupId: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-29T11:00:00.000Z',
    updatedAt: '2026-10-29T11:00:00.000Z',
    ...overrides,
  });

  /** The pending job is read and its start accepted. */
  const readAndStart = (): void => {
    jobs.get.mockResolvedValueOnce({ job: job() });
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'processing', attempts: 1 }) });
  };

  beforeEach(() => {
    jobs = mockDeep<JobRepository>();
    email = mockDeep<JobHandler>();
    logger = mockDeep<Pick<LoggerService, 'log' | 'warn' | 'error'>>();
    execution = new JobExecutionImpl({ jobs, handlers: { email }, logger }, PARAMS);
  });

  it('Pending job runs to completion', async () => {
    readAndStart();
    email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

    // The queue's attempt is passed on, not one derived from the job read before start.
    const entry = { ...ENTRY, attempt: 3 };

    await expect(execution.execute(entry)).resolves.toEqual({ outcome: 'completed' });

    expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
      { status: 'processing' },
      { status: 'completed', result: RESULT },
    ]);
    expect(email.run).toHaveBeenCalledExactlyOnceWith({
      job: job(),
      attempt: 3,
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('Job already taken or finished', async () => {
    for (const status of ['processing', 'completed', 'failed', 'cancelled'] as const) {
      jobs.get.mockResolvedValueOnce({ job: job({ status }) });

      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });
      expect(logger.log).toHaveBeenLastCalledWith(
        { jobId: JOB_ID, attempt: 1, status },
        expect.stringContaining('Skipped'),
      );
    }
    expect(email.run).not.toHaveBeenCalled();
    expect(jobs.update).not.toHaveBeenCalled();
  });

  it('Job deleted', async () => {
    jobs.get.mockRejectedValueOnce(new JobNotFoundError({ id: JOB_ID }));

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });
    expect(email.run).not.toHaveBeenCalled();
    expect(jobs.update).not.toHaveBeenCalled();
  });

  it('Another worker started the job first', async () => {
    jobs.get.mockResolvedValueOnce({ job: job() });
    jobs.update.mockRejectedValueOnce(new JobStatusConflictError({ id: JOB_ID }));

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

    expect(email.run).not.toHaveBeenCalled();
    expect(jobs.update).toHaveBeenCalledOnce();
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB_ID, attempt: 1 }),
      expect.any(String),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('Job deleted before it could be started', async () => {
    jobs.get.mockResolvedValueOnce({ job: job() });
    jobs.update.mockRejectedValueOnce(new JobNotFoundError({ id: JOB_ID }));

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

    expect(email.run).not.toHaveBeenCalled();
    expect(jobs.update).toHaveBeenCalledOnce();
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB_ID, attempt: 1 }),
      expect.any(String),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('Invalid payload', async () => {
    const issues = [{ code: 'invalid_format', path: ['payload', 'to'], message: 'Invalid email' }];
    jobs.get.mockRejectedValueOnce(new InvalidJobError({ id: JOB_ID, issues }));
    jobs.update
      .mockResolvedValueOnce({ job: job({ status: 'processing', attempts: 1 }) })
      .mockResolvedValueOnce({ job: job({ status: 'failed' }) });

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

    // job-service accepts a failure only for a started job, so the worker starts it first.
    expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
      { status: 'processing' },
      {
        status: 'failed',
        error: {
          code: 'INVALID_PAYLOAD',
          message: expect.any(String) as string,
          details: { id: JOB_ID, issues },
        },
      },
    ]);
    expect(email.run).not.toHaveBeenCalled();
  });

  it('skips an invalid job that another worker already started', async () => {
    jobs.get.mockRejectedValueOnce(
      new InvalidJobError({ id: JOB_ID, issues: [{ code: 'x', path: ['payload'], message: 'x' }] }),
    );
    jobs.update.mockRejectedValueOnce(new JobStatusConflictError({ id: JOB_ID }));

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });
    expect(jobs.update).toHaveBeenCalledOnce();
  });

  it('No handler for the type', async () => {
    const withoutHandlers = new JobExecutionImpl({ jobs, handlers: {}, logger }, PARAMS);
    readAndStart();
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'failed' }) });

    await expect(withoutHandlers.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

    expect(jobs.update).toHaveBeenLastCalledWith({
      id: JOB_ID,
      update: {
        status: 'failed',
        error: expect.objectContaining({ code: 'UNSUPPORTED_JOB_TYPE' }) as object,
      },
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('Handler throws a coded error', async () => {
    readAndStart();
    email.run.mockRejectedValueOnce(new SendRefusedError());
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'pending' }) });

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

    expect(jobs.update).toHaveBeenLastCalledWith({
      id: JOB_ID,
      update: {
        status: 'failed',
        error: { code: 'VALIDATION_FAILED', message: 'Mailbox refused the message' },
      },
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('Handler throws an unexpected error', async () => {
    readAndStart();
    email.run.mockRejectedValueOnce(new Error('socket hang up'));
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'pending' }) });

    await execution.execute(ENTRY);

    expect(jobs.update).toHaveBeenLastCalledWith({
      id: JOB_ID,
      update: { status: 'failed', error: { code: 'HANDLER_ERROR', message: 'socket hang up' } },
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  describe('when a handler returns a failed outcome', () => {
    const WEBHOOK_ERROR = {
      code: 'WEBHOOK_HTTP_ERROR',
      message: 'Webhook POST https://example.com/hook answered 503',
      details: { statusCode: 503 },
    };
    let webhook: DeepMockProxy<JobHandler>;
    let withWebhook: JobExecutionImpl;

    const webhookJob = (overrides: Partial<WebhookJob> = {}): WebhookJob => ({
      ...job(),
      type: 'webhook',
      payload: { method: 'POST', url: 'https://example.com/hook', body: { a: 1 } },
      result: null,
      ...overrides,
    });

    beforeEach(() => {
      webhook = mockDeep<JobHandler>();
      withWebhook = new JobExecutionImpl({ jobs, handlers: { webhook }, logger }, PARAMS);
      jobs.get.mockResolvedValueOnce({ job: webhookJob() });
      jobs.update
        .mockResolvedValueOnce({ job: webhookJob({ status: 'processing', attempts: 1 }) })
        .mockResolvedValueOnce({ job: webhookJob({ status: 'pending', attempts: 1 }) });
      webhook.run.mockResolvedValueOnce({ outcome: 'failed', error: WEBHOOK_ERROR });
    });

    it('reports the returned error as is and no completion', async () => {
      await expect(withWebhook.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

      expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
        { status: 'processing' },
        { status: 'failed', error: WEBHOOK_ERROR },
      ]);
    });

    it('Failed webhook attempt is logged as a warning', async () => {
      await withWebhook.execute(ENTRY);

      // The instance id is added to every line by the logger itself.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: JOB_ID,
          attempt: 1,
          code: 'WEBHOOK_HTTP_ERROR',
          details: { statusCode: 503 },
        }),
        expect.any(String),
      );
    });
  });

  it('Failed transit attempt is logged as a warning', async () => {
    const transit = mockDeep<JobHandler>();
    const withTransit = new JobExecutionImpl(
      { jobs, handlers: { 'flight-transit': transit }, logger },
      PARAMS,
    );
    const transitJob = (overrides: Partial<FlightTransitJob> = {}): FlightTransitJob => ({
      ...job(),
      type: 'flight-transit',
      payload: { origin: 'LHR', destination: 'JFK', departureDate: '2026-11-02' },
      result: null,
      ...overrides,
    });
    const error = {
      code: 'FLIGHT_TRANSIT_DATA_UNAVAILABLE',
      message: 'Flight data for LHR-JFK is unavailable',
      details: { origin: 'LHR', destination: 'JFK' },
    };
    jobs.get.mockResolvedValueOnce({ job: transitJob() });
    jobs.update
      .mockResolvedValueOnce({ job: transitJob({ status: 'processing', attempts: 1 }) })
      .mockResolvedValueOnce({ job: transitJob({ status: 'pending', attempts: 1 }) });
    transit.run.mockResolvedValueOnce({ outcome: 'failed', error });

    await expect(withTransit.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

    // The instance id is added to every line by the logger itself.
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        jobId: JOB_ID,
        attempt: 1,
        code: 'FLIGHT_TRANSIT_DATA_UNAVAILABLE',
        details: { origin: 'LHR', destination: 'JFK' },
      }),
      expect.any(String),
    );
  });

  it('Grace period runs out', async () => {
    readAndStart();
    email.run.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error);
          });
        }),
    );

    const running = execution.execute(ENTRY);
    await expect.poll(() => email.run.mock.calls.length).toBe(1);
    execution.abort();

    await expect(running).resolves.toEqual({ outcome: 'abandoned' });
    expect(jobs.update).toHaveBeenCalledOnce();
  });

  it('Grace period runs out during a report retry', async () => {
    const slowRetries = new JobExecutionImpl(
      { jobs, handlers: { email }, logger },
      { reportRetries: 2, reportRetryDelayMs: 60_000, reportRetryMaxDelayMs: 60_000 },
    );
    readAndStart();
    email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
    jobs.update.mockRejectedValueOnce(new JobServiceUnavailableError({ reason: 'HTTP 503' }));

    const running = slowRetries.execute(ENTRY);
    await expect.poll(() => jobs.update.mock.calls.length).toBe(2);
    slowRetries.abort();

    // The wait before the next try is a minute; the abort ends it at once.
    await expect(running).resolves.toEqual({ outcome: 'abandoned' });
    expect(jobs.update).toHaveBeenCalledTimes(2);
  });

  it('passes the abort signal to every call to job-service', async () => {
    readAndStart();
    email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

    await execution.execute(ENTRY);

    for (const [request] of [...jobs.get.mock.calls, ...jobs.update.mock.calls]) {
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
  });

  describe('while job-service is unavailable', () => {
    const unavailable = (): JobServiceUnavailableError =>
      new JobServiceUnavailableError({ reason: 'HTTP 503' });

    /** Runs the entry to its end, letting every retry wait pass. */
    const executeWithWaits = async (): Promise<unknown> => {
      const running = execution.execute(ENTRY);
      await vi.runAllTimersAsync();
      return running;
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('Report succeeds after a retry', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update
        .mockRejectedValueOnce(unavailable())
        .mockResolvedValueOnce({ job: job({ status: 'completed' }) });

      await expect(executeWithWaits()).resolves.toEqual({ outcome: 'completed' });
      expect(jobs.update).toHaveBeenCalledTimes(3);
    });

    it('Report keeps failing', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      for (let i = 0; i <= PARAMS.reportRetries; i += 1) {
        jobs.update.mockRejectedValueOnce(unavailable());
      }

      await expect(executeWithWaits()).resolves.toEqual({ outcome: 'abandoned' });

      expect(jobs.update).toHaveBeenCalledTimes(1 + 1 + PARAMS.reportRetries);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID }),
        expect.any(String),
      );
    });

    it('waits longer before each retry, up to the configured maximum', async () => {
      // No randomization: the waits are the delay, then double it capped at the maximum.
      vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0);
      for (let i = 0; i <= PARAMS.reportRetries; i += 1) {
        jobs.get.mockRejectedValueOnce(unavailable());
      }

      const running = execution.execute(ENTRY);
      const triesAfter = async (ms: number): Promise<number> => {
        await vi.advanceTimersByTimeAsync(ms);
        return jobs.get.mock.calls.length;
      };

      expect(await triesAfter(0)).toBe(1);
      expect(await triesAfter(PARAMS.reportRetryDelayMs - 1)).toBe(1);
      expect(await triesAfter(1)).toBe(2);
      expect(await triesAfter(PARAMS.reportRetryMaxDelayMs - 1)).toBe(2);
      expect(await triesAfter(1)).toBe(3);
      await expect(running).resolves.toEqual({ outcome: 'abandoned' });
    });

    it('reads the job again, then runs it', async () => {
      jobs.get.mockRejectedValueOnce(unavailable());
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

      await expect(executeWithWaits()).resolves.toEqual({ outcome: 'completed' });
      expect(jobs.get).toHaveBeenCalledTimes(2);
    });

    it('gives up reading the job when it stays unavailable', async () => {
      for (let i = 0; i <= PARAMS.reportRetries; i += 1) {
        jobs.get.mockRejectedValueOnce(unavailable());
      }

      await expect(executeWithWaits()).resolves.toEqual({ outcome: 'abandoned' });

      expect(jobs.get).toHaveBeenCalledTimes(1 + PARAMS.reportRetries);
      expect(jobs.update).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID }),
        expect.any(String),
      );
    });
  });

  it('Logs of a completed job', async () => {
    readAndStart();
    email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

    await execution.execute(ENTRY);

    const lines = [...logger.log.mock.calls, ...logger.warn.mock.calls];
    expect(lines.length).toBeGreaterThan(0);
    for (const [fields] of lines) {
      expect(fields).toMatchObject({ jobId: JOB_ID, attempt: 1 });
    }
  });
});
