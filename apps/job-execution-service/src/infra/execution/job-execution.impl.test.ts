import { randomUUID } from 'node:crypto';

import type { EmailJob, FlightTransitJob, Job, WebhookJob } from '@job-queue/contracts';
import {
  type Clock,
  DomainError,
  JobNotFoundError,
  JobServiceUnavailableError,
  JobStatusConflictError,
} from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { InvalidJobError } from '../../domain/jobs/errors/invalid-job.error.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';
import type { JobHandler } from '../../domain/execution/job-handler.js';
import { JobExecutionImpl } from './job-execution.impl.js';

const JOB_ID = randomUUID();
const ENTRY = { jobId: JOB_ID, run: 1, attempt: 1 };
/** The fields of the log lines about `ENTRY`. */
const FIELDS = { jobId: JOB_ID, attempt: 1 };
/** The run and attempt every report of `ENTRY` carries. */
const AT = { run: 1, attempt: 1 };
const MAX_PROCESSING_MS = 30_000;
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
  let clock: DeepMockProxy<Clock>;
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
    idempotencyKey: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-29T11:00:00.000Z',
    updatedAt: '2026-10-29T11:00:00.000Z',
    ...overrides,
  });

  /** What job-service answers to a read: the job with its type's time limit. */
  const read = (readJob: Job): { job: Job; maxProcessingMs: number } => ({
    job: readJob,
    maxProcessingMs: MAX_PROCESSING_MS,
  });

  /** The clock reads these instants, in order (a handler run reads it twice). */
  const clockReads = (...times: number[]): void => {
    for (const time of times) clock.now.mockReturnValueOnce({ now: new Date(time) });
  };

  /**
   * The pending job is read and its start accepted; the clock reads the given instants (the
   * handler run's start and end, equal by default).
   */
  const readAndStart = (...times: number[]): void => {
    clockReads(...(times.length > 0 ? times : [0, 0]));
    jobs.get.mockResolvedValueOnce(read(job()));
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'processing', attempts: 1 }) });
  };

  /** A handler that runs until its signal is aborted, then rejects with the abort reason. */
  const runsUntilAborted = (handler: DeepMockProxy<JobHandler>): void => {
    handler.run.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error);
          });
        }),
    );
  };

  beforeEach(() => {
    jobs = mockDeep<JobRepository>();
    email = mockDeep<JobHandler>();
    clock = mockDeep<Clock>();
    logger = mockDeep<Pick<LoggerService, 'log' | 'warn' | 'error'>>();
    execution = new JobExecutionImpl({ jobs, handlers: { email }, clock, logger }, PARAMS);
  });

  it('Pending job runs to completion', async () => {
    readAndStart();
    email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

    // The queue's attempt is passed on, not one derived from the job read before start.
    const entry = { ...ENTRY, attempt: 3 };

    await expect(execution.execute(entry)).resolves.toEqual({ outcome: 'completed' });

    expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
      { status: 'processing', ...AT, attempt: 3 },
      { status: 'completed', result: RESULT, ...AT, attempt: 3 },
    ]);
    expect(email.run).toHaveBeenCalledExactlyOnceWith({
      job: job(),
      attempt: 3,
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('Scheduled job runs to completion', async () => {
    const scheduled = job({ status: 'scheduled', scheduledAt: '2026-10-29T11:30:00.000Z' });
    clockReads(0, 0);
    jobs.get.mockResolvedValueOnce(read(scheduled));
    jobs.update.mockResolvedValueOnce({ job: { ...scheduled, status: 'processing', attempts: 1 } });
    email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
    jobs.update.mockResolvedValueOnce({ job: { ...scheduled, status: 'completed' } });

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'completed' });

    expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
      { status: 'processing', ...AT },
      { status: 'completed', result: RESULT, ...AT },
    ]);
    expect(email.run).toHaveBeenCalledExactlyOnceWith({
      job: scheduled,
      attempt: 1,
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('Job already taken or finished', async () => {
    for (const status of ['processing', 'completed', 'failed', 'cancelled'] as const) {
      jobs.get.mockResolvedValueOnce(read(job({ status })));

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
    jobs.get.mockResolvedValueOnce(read(job()));
    jobs.update.mockRejectedValueOnce(
      new JobStatusConflictError({ id: JOB_ID, status: 'processing' }),
    );

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

    expect(email.run).not.toHaveBeenCalled();
    expect(jobs.update).toHaveBeenCalledOnce();
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB_ID, attempt: 1 }),
      expect.any(String),
    );
    // A lost start is a plain race, never the warning for a recovered attempt.
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('Job deleted before it could be started', async () => {
    jobs.get.mockResolvedValueOnce(read(job()));
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
      { status: 'processing', ...AT },
      {
        status: 'failed',
        ...AT,
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

  it('gives up on an entry whose job cannot be read for an unexpected reason', async () => {
    jobs.get.mockRejectedValueOnce(new Error('unexpected response'));

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'abandoned' });

    expect(jobs.get).toHaveBeenCalledOnce();
    expect(jobs.update).not.toHaveBeenCalled();
    expect(email.run).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ jobId: JOB_ID, attempt: 1 }),
      expect.any(String),
    );
  });

  it('abandons the entry when the grace period runs out while the job is read', async () => {
    jobs.get.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(signal.reason as Error);
          });
        }),
    );

    const running = execution.execute(ENTRY);
    await expect.poll(() => jobs.get.mock.calls.length).toBe(1);
    execution.abort();

    await expect(running).resolves.toEqual({ outcome: 'abandoned' });
    expect(jobs.update).not.toHaveBeenCalled();
    expect(email.run).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('abandons a job whose handler resolves after the grace period ran out', async () => {
    readAndStart();
    email.run.mockImplementationOnce(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve({ outcome: 'completed', result: RESULT });
          });
        }),
    );

    const running = execution.execute(ENTRY);
    await expect.poll(() => email.run.mock.calls.length).toBe(1);
    execution.abort();

    // The late result is not reported: the job stays processing.
    await expect(running).resolves.toEqual({ outcome: 'abandoned' });
    expect(jobs.update).toHaveBeenCalledOnce();
  });

  describe.each([
    ['a status conflict', (): Error => new JobStatusConflictError({ id: JOB_ID })],
    ['not found', (): Error => new JobNotFoundError({ id: JOB_ID })],
  ])('when job-service answers a report with %s', (_answer, refusal) => {
    // Another party changed the job (a cancel, a delete): a lost race, so the entry is skipped.
    it('skips the entry after its completion is refused', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update.mockRejectedValueOnce(refusal());

      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

      expect(jobs.update.mock.calls.map(([request]) => request.update.status)).toEqual([
        'processing',
        'completed',
      ]);
      // Without a current status there is no sign of a recovery: info, not the warning.
      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID, status: 'completed' }),
        expect.stringMatching(/^Report refused/),
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('skips the entry after its failure is refused', async () => {
      readAndStart();
      email.run.mockRejectedValueOnce(new SendRefusedError());
      jobs.update.mockRejectedValueOnce(refusal());

      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

      expect(jobs.update.mock.calls.map(([request]) => request.update.status)).toEqual([
        'processing',
        'failed',
      ]);
      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID, status: 'failed' }),
        expect.stringMatching(/^Report refused/),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  it('gives up on an entry whose start fails for an unexpected reason', async () => {
    jobs.get.mockResolvedValueOnce(read(job()));
    jobs.update.mockRejectedValueOnce(new Error('unexpected response'));

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'abandoned' });

    expect(jobs.update).toHaveBeenCalledOnce();
    expect(email.run).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ jobId: JOB_ID, attempt: 1, status: 'processing' }),
      expect.any(String),
    );
  });

  it('abandons the entry instead of rejecting when a step throws unexpectedly', async () => {
    readAndStart();
    const bug = new Error('log line failed');
    logger.log.mockImplementationOnce(() => {
      throw bug;
    });

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'abandoned' });

    expect(email.run).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      { jobId: JOB_ID, attempt: 1, err: bug },
      expect.any(String),
    );
  });

  it('No handler for the type', async () => {
    const withoutHandlers = new JobExecutionImpl({ jobs, handlers: {}, clock, logger }, PARAMS);
    jobs.get.mockResolvedValueOnce(read(job()));
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'processing', attempts: 1 }) });
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'failed' }) });

    await expect(withoutHandlers.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

    expect(jobs.update).toHaveBeenLastCalledWith({
      id: JOB_ID,
      update: {
        status: 'failed',
        ...AT,
        error: expect.objectContaining({ code: 'UNSUPPORTED_JOB_TYPE' }) as object,
      },
      signal: expect.any(AbortSignal) as AbortSignal,
    });
    expect(clock.now).not.toHaveBeenCalled();
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
        ...AT,
        error: { code: 'VALIDATION_FAILED', message: 'Mailbox refused the message' },
      },
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('Handler throws an unexpected error', async () => {
    readAndStart();
    email.run.mockRejectedValueOnce(new Error('socket hang up'));
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'pending' }) });

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

    expect(jobs.update).toHaveBeenLastCalledWith({
      id: JOB_ID,
      update: {
        status: 'failed',
        error: { code: 'HANDLER_ERROR', message: 'socket hang up' },
        ...AT,
      },
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('reports a handler rejection that is not an Error by its text', async () => {
    readAndStart();
    email.run.mockRejectedValueOnce('connection reset');
    jobs.update.mockResolvedValueOnce({ job: job({ status: 'pending' }) });

    await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

    expect(jobs.update).toHaveBeenLastCalledWith({
      id: JOB_ID,
      update: {
        status: 'failed',
        error: { code: 'HANDLER_ERROR', message: 'connection reset' },
        ...AT,
      },
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
      withWebhook = new JobExecutionImpl({ jobs, handlers: { webhook }, clock, logger }, PARAMS);
      jobs.get.mockResolvedValueOnce(read(webhookJob()));
      jobs.update
        .mockResolvedValueOnce({ job: webhookJob({ status: 'processing', attempts: 1 }) })
        .mockResolvedValueOnce({ job: webhookJob({ status: 'pending', attempts: 1 }) });
      clockReads(0, 0);
      webhook.run.mockResolvedValueOnce({ outcome: 'failed', error: WEBHOOK_ERROR });
    });

    it('reports the returned error as is and no completion', async () => {
      await expect(withWebhook.execute(ENTRY)).resolves.toEqual({ outcome: 'failed' });

      expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
        { status: 'processing', ...AT },
        { status: 'failed', error: WEBHOOK_ERROR, ...AT },
      ]);
    });

    it('Failed webhook attempt is logged as a warning', async () => {
      await withWebhook.execute(ENTRY);

      // The instance id is added to every line by the logger itself.
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
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
      { jobs, handlers: { 'flight-transit': transit }, clock, logger },
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
    jobs.get.mockResolvedValueOnce(read(transitJob()));
    jobs.update
      .mockResolvedValueOnce({ job: transitJob({ status: 'processing', attempts: 1 }) })
      .mockResolvedValueOnce({ job: transitJob({ status: 'pending', attempts: 1 }) });
    clockReads(0, 0);
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
    expect(logger.log).toHaveBeenCalledWith({ ...FIELDS, durationMs: 0 }, 'Handler finished');
  });

  describe('when job-service cancels a job', () => {
    it('Running job is cancelled', async () => {
      readAndStart();
      runsUntilAborted(email);

      const running = execution.execute(ENTRY);
      await expect.poll(() => email.run.mock.calls.length).toBe(1);
      expect(execution.cancel({ jobId: JOB_ID })).toEqual({});

      await expect(running).resolves.toEqual({ outcome: 'cancelled' });
      expect(email.run.mock.calls[0]?.[0].signal.aborted).toBe(true);
      expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
        { status: 'processing', ...AT },
      ]);
      expect(logger.log).toHaveBeenCalledWith(
        { jobId: JOB_ID, attempt: 1 },
        expect.stringContaining('cancelled'),
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('reports nothing when the handler finishes after the cancel without noticing it', async () => {
      readAndStart();
      let finish: (value: { outcome: 'completed'; result: unknown }) => void = () => undefined;
      email.run.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );

      const running = execution.execute(ENTRY);
      await expect.poll(() => email.run.mock.calls.length).toBe(1);
      execution.cancel({ jobId: JOB_ID });
      finish({ outcome: 'completed', result: RESULT });

      await expect(running).resolves.toEqual({ outcome: 'cancelled' });
      expect(jobs.update).toHaveBeenCalledOnce();
    });

    it('stops a job whose cancel arrives while its start is being reported', async () => {
      jobs.get.mockResolvedValueOnce(read(job()));
      jobs.update.mockImplementationOnce(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(signal.reason as Error);
            });
          }),
      );

      const running = execution.execute(ENTRY);
      await expect.poll(() => jobs.update.mock.calls.length).toBe(1);
      execution.cancel({ jobId: JOB_ID });

      await expect(running).resolves.toEqual({ outcome: 'cancelled' });
      expect(email.run).not.toHaveBeenCalled();
      expect(jobs.update).toHaveBeenCalledOnce();
    });

    it('Cancellation of a job this worker does not run', async () => {
      readAndStart();
      let finish: (value: { outcome: 'completed'; result: unknown }) => void = () => undefined;
      email.run.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

      const running = execution.execute(ENTRY);
      await expect.poll(() => email.run.mock.calls.length).toBe(1);
      expect(execution.cancel({ jobId: randomUUID() })).toEqual({});
      expect(email.run.mock.calls[0]?.[0].signal.aborted).toBe(false);
      finish({ outcome: 'completed', result: RESULT });

      await expect(running).resolves.toEqual({ outcome: 'completed' });
      expect(logger.log).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('cancelled'),
      );
    });

    it('ignores a cancellation when it runs no job at all', () => {
      expect(execution.cancel({ jobId: JOB_ID })).toEqual({});
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('stops a job whose cancel arrives while it is being read', async () => {
      jobs.get.mockImplementationOnce(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(signal.reason as Error);
            });
          }),
      );

      const running = execution.execute(ENTRY);
      await expect.poll(() => jobs.get.mock.calls.length).toBe(1);
      execution.cancel({ jobId: JOB_ID });

      await expect(running).resolves.toEqual({ outcome: 'cancelled' });
      expect(jobs.update).not.toHaveBeenCalled();
      expect(email.run).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        { jobId: JOB_ID, attempt: 1 },
        expect.stringContaining('cancelled'),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('stops every entry of the job it runs, also after another entry of it settled', async () => {
      // Entry A runs; entry B of the same job (a redelivery) starts later and is skipped first.
      readAndStart();
      runsUntilAborted(email);
      const first = execution.execute(ENTRY);
      await expect.poll(() => email.run.mock.calls.length).toBe(1);
      jobs.get.mockResolvedValueOnce(read(job({ status: 'processing', attempts: 1 })));
      await expect(execution.execute({ jobId: JOB_ID, run: 1, attempt: 2 })).resolves.toEqual({
        outcome: 'skipped',
      });

      execution.cancel({ jobId: JOB_ID });

      await expect(first).resolves.toEqual({ outcome: 'cancelled' });
      expect(email.run.mock.calls[0]?.[0].signal.aborted).toBe(true);
    });

    it('does not stop a later entry of a job with a cancel meant for an earlier one', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });
      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'completed' });
      execution.cancel({ jobId: JOB_ID });
      readAndStart();
      let finish: (value: { outcome: 'completed'; result: unknown }) => void = () => undefined;
      email.run.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

      const later = execution.execute({ jobId: JOB_ID, run: 1, attempt: 2 });
      await expect.poll(() => email.run.mock.calls.length).toBe(2);
      expect(email.run.mock.calls[1]?.[0].signal.aborted).toBe(false);
      finish({ outcome: 'completed', result: RESULT });

      await expect(later).resolves.toEqual({ outcome: 'completed' });
    });

    it('Other jobs keep running', async () => {
      const otherId = randomUUID();
      const other = job({ id: otherId });
      // Each handler run reads the clock at its start and its end.
      clockReads(0, 0, 0, 0);
      jobs.get.mockResolvedValueOnce(read(job())).mockResolvedValueOnce(read(other));
      jobs.update
        .mockResolvedValueOnce({ job: job({ status: 'processing', attempts: 1 }) })
        .mockResolvedValueOnce({ job: { ...other, status: 'processing', attempts: 1 } })
        .mockResolvedValueOnce({ job: { ...other, status: 'completed' } });
      runsUntilAborted(email);
      let finishOther: (value: { outcome: 'completed'; result: unknown }) => void = () => undefined;
      email.run.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOther = resolve;
          }),
      );

      const cancelled = execution.execute(ENTRY);
      await expect.poll(() => email.run.mock.calls.length).toBe(1);
      const kept = execution.execute({ jobId: otherId, run: 1, attempt: 1 });
      await expect.poll(() => email.run.mock.calls.length).toBe(2);
      execution.cancel({ jobId: JOB_ID });

      await expect(cancelled).resolves.toEqual({ outcome: 'cancelled' });
      expect(email.run.mock.calls[1]?.[0].signal.aborted).toBe(false);
      finishOther({ outcome: 'completed', result: RESULT });
      await expect(kept).resolves.toEqual({ outcome: 'completed' });
      expect(jobs.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: otherId,
          update: { status: 'completed', result: RESULT, ...AT },
        }),
      );
    });

    it('Completion refused after a cancel', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'cancelled' }),
      );

      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

      expect(jobs.update).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenCalledWith(
        { jobId: JOB_ID, attempt: 1, status: 'completed' },
        expect.stringContaining('refused'),
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('takes a refused failure report as a lost race, not an error', async () => {
      readAndStart();
      email.run.mockRejectedValueOnce(new SendRefusedError());
      jobs.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'cancelled' }),
      );

      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

      expect(jobs.update).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenCalledWith(
        { jobId: JOB_ID, attempt: 1, status: 'failed' },
        expect.stringContaining('refused'),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('reports name the entry', () => {
    it('Reports of one entry', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

      await execution.execute({ jobId: JOB_ID, run: 1, attempt: 2 });

      expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
        { status: 'processing', run: 1, attempt: 2 },
        { status: 'completed', result: RESULT, run: 1, attempt: 2 },
      ]);
    });

    it('names the run of a retried job in a failure report', async () => {
      readAndStart();
      email.run.mockRejectedValueOnce(new Error('socket hang up'));
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'failed' }) });

      await execution.execute({ jobId: JOB_ID, run: 3, attempt: 1 });

      expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
        { status: 'processing', run: 3, attempt: 1 },
        {
          status: 'failed',
          error: { code: 'HANDLER_ERROR', message: 'socket hang up' },
          run: 3,
          attempt: 1,
        },
      ]);
    });
  });

  describe('the maximum processing time', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('Handler exceeds the time limit', async () => {
      readAndStart();
      runsUntilAborted(email);
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'failed' }) });

      const running = execution.execute(ENTRY);
      await vi.advanceTimersByTimeAsync(MAX_PROCESSING_MS - 1);
      expect(email.run.mock.calls[0]?.[0].signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(running).resolves.toEqual({ outcome: 'failed' });
      expect(email.run.mock.calls[0]?.[0].signal.aborted).toBe(true);
      expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
        { status: 'processing', ...AT },
        {
          status: 'failed',
          error: {
            code: 'JOB_TIMEOUT',
            message: expect.any(String) as string,
            details: { maxProcessingMs: MAX_PROCESSING_MS },
          },
          ...AT,
        },
      ]);
      // The failure report is not itself cut short by the timeout.
      expect(jobs.update.mock.lastCall?.[0].signal?.aborted).toBe(false);
    });

    it('reports a timeout for a handler that finishes after the limit without noticing it', async () => {
      readAndStart();
      let finish: (value: { outcome: 'completed'; result: unknown }) => void = () => undefined;
      email.run.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'failed' }) });

      const running = execution.execute(ENTRY);
      await vi.advanceTimersByTimeAsync(MAX_PROCESSING_MS);
      finish({ outcome: 'completed', result: RESULT });

      await expect(running).resolves.toEqual({ outcome: 'failed' });
      expect(jobs.update.mock.calls.map(([request]) => request.update.status)).toEqual([
        'processing',
        'failed',
      ]);
    });

    it('Handler within the time limit', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'completed' });
      await vi.advanceTimersByTimeAsync(MAX_PROCESSING_MS * 2);

      expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
        { status: 'processing', ...AT },
        { status: 'completed', result: RESULT, ...AT },
      ]);
      expect(email.run.mock.calls[0]?.[0].signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('Cancel and timeout are told apart', async () => {
      readAndStart();
      runsUntilAborted(email);

      const running = execution.execute(ENTRY);
      await vi.advanceTimersByTimeAsync(MAX_PROCESSING_MS - 1);
      execution.cancel({ jobId: JOB_ID });

      await expect(running).resolves.toEqual({ outcome: 'cancelled' });
      await vi.advanceTimersByTimeAsync(MAX_PROCESSING_MS);
      expect(jobs.update.mock.calls.map(([request]) => request.update)).toEqual([
        { status: 'processing', ...AT },
      ]);
    });

    it('reports nothing for a timeout that fires after the grace period ran out', async () => {
      readAndStart();
      runsUntilAborted(email);

      const running = execution.execute(ENTRY);
      await vi.advanceTimersByTimeAsync(MAX_PROCESSING_MS - 1);
      execution.abort();

      await expect(running).resolves.toEqual({ outcome: 'abandoned' });
      await vi.advanceTimersByTimeAsync(MAX_PROCESSING_MS);
      expect(jobs.update).toHaveBeenCalledOnce();
    });

    it('measures the limit from the job-service answer, per job', async () => {
      clockReads(0, 0);
      jobs.get.mockResolvedValueOnce({ job: job(), maxProcessingMs: 5_000 });
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'processing', attempts: 1 }) });
      runsUntilAborted(email);
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'failed' }) });

      const running = execution.execute(ENTRY);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(running).resolves.toEqual({ outcome: 'failed' });
      expect(jobs.update.mock.lastCall?.[0].update).toMatchObject({
        error: { code: 'JOB_TIMEOUT', details: { maxProcessingMs: 5_000 } },
      });
    });
  });

  describe('when a report is refused because the attempt was recovered', () => {
    it('Completion refused after a recovery', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'scheduled' }),
      );

      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

      // The start and the refused completion; nothing is sent after the refusal.
      expect(jobs.update.mock.calls.map(([request]) => request.update.status)).toEqual([
        'processing',
        'completed',
      ]);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        { ...FIELDS, run: 1, status: 'completed', jobStatus: 'scheduled' },
        'Report refused: the attempt was recovered',
      );
      expect(logger.log).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Report refused'),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('warns also when the refused report was a failure', async () => {
      readAndStart();
      email.run.mockRejectedValueOnce(new SendRefusedError());
      jobs.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'processing' }),
      );

      await expect(execution.execute(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

      expect(jobs.update).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        { ...FIELDS, run: 1, status: 'failed', jobStatus: 'processing' },
        'Report refused: the attempt was recovered',
      );
    });
  });

  it('Grace period runs out during a report retry', async () => {
    const slowRetries = new JobExecutionImpl(
      { jobs, handlers: { email }, clock, logger },
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
    execution.abort();

    const signals = [...jobs.get.mock.calls, ...jobs.update.mock.calls].map(
      ([request]) => request.signal,
    );
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
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
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        { jobId: JOB_ID, attempt: 1, retry: 1 },
        expect.any(String),
      );
    });

    it('Report keeps failing', async () => {
      readAndStart();
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      for (let i = 0; i <= PARAMS.reportRetries; i += 1) {
        jobs.update.mockRejectedValueOnce(unavailable());
      }

      await expect(executeWithWaits()).resolves.toEqual({ outcome: 'abandoned' });

      expect(jobs.update).toHaveBeenCalledTimes(1 + 1 + PARAMS.reportRetries);
      expect(jobs.update.mock.lastCall?.[0].update.status).toBe('completed');
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ jobId: JOB_ID, attempt: 1, status: 'completed' }),
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

    it('gives up starting the job when job-service stays unavailable', async () => {
      jobs.get.mockResolvedValueOnce(read(job()));
      for (let i = 0; i <= PARAMS.reportRetries; i += 1) {
        jobs.update.mockRejectedValueOnce(unavailable());
      }

      await expect(executeWithWaits()).resolves.toEqual({ outcome: 'abandoned' });

      expect(jobs.update).toHaveBeenCalledTimes(1 + PARAMS.reportRetries);
      expect(jobs.update.mock.calls.map(([request]) => request.update.status)).toEqual(
        Array.from({ length: 1 + PARAMS.reportRetries }, () => 'processing'),
      );
      expect(email.run).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ jobId: JOB_ID, status: 'processing' }),
        expect.any(String),
      );
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
  describe('job log lines', () => {
    it('Run of an attempt is logged', async () => {
      readAndStart(1_000, 1_250);
      email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'completed' }) });

      await execution.execute({ ...ENTRY, attempt: 2 });

      const fields = { jobId: JOB_ID, attempt: 2 };
      const steps = logger.log.mock.calls.filter(([, message]) =>
        ['Attempt picked up', 'Handler started', 'Handler finished'].includes(message as string),
      );
      expect(steps).toEqual([
        [fields, 'Attempt picked up'],
        [fields, 'Handler started'],
        [{ ...fields, durationMs: 250 }, 'Handler finished'],
      ]);
    });

    it('Handler finished is logged when the handler throws', async () => {
      readAndStart(1_000, 1_040);
      email.run.mockRejectedValueOnce(new Error('boom'));
      jobs.update.mockResolvedValueOnce({ job: job({ status: 'failed' }) });

      await execution.execute(ENTRY);

      expect(logger.log).toHaveBeenCalledWith({ ...FIELDS, durationMs: 40 }, 'Handler finished');
    });

    it('Handler is not logged when the job is skipped', async () => {
      jobs.get.mockResolvedValueOnce(read(job({ status: 'completed' })));

      await execution.execute(ENTRY);

      const messages = logger.log.mock.calls.map(([, message]) => message as unknown);
      expect(messages).not.toContain('Handler started');
      expect(messages).not.toContain('Handler finished');
    });

    it('Retried state report is logged', async () => {
      vi.useFakeTimers();
      try {
        readAndStart(1_000, 1_001);
        email.run.mockResolvedValueOnce({ outcome: 'completed', result: RESULT });
        jobs.update
          .mockRejectedValueOnce(new JobServiceUnavailableError({ reason: 'HTTP 503' }))
          .mockResolvedValueOnce({ job: job({ status: 'completed' }) });

        const running = execution.execute(ENTRY);
        await vi.runAllTimersAsync();
        await running;

        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
          { ...FIELDS, retry: 1 },
          'job-service unavailable, retrying',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('Dropped entry is logged', async () => {
      jobs.get.mockResolvedValueOnce(read(job({ status: 'processing', attempts: 1 })));

      await execution.execute(ENTRY);

      expect(logger.log.mock.calls).toEqual([
        [FIELDS, 'Attempt picked up'],
        [{ ...FIELDS, status: 'processing' }, 'Skipped: job is no longer startable'],
      ]);
    });
  });
});
