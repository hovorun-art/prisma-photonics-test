import { randomUUID } from 'node:crypto';

import {
  JobNotFoundError,
  JobServiceUnavailableError,
  JobStatusConflictError,
} from '@job-queue/kernel';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidJobError } from '../../src/domain/jobs/errors/invalid-job.error.js';
import {
  INSTANCE_ID,
  JobExecutionServiceUnderTest,
  TEST_CONFIG,
} from './job-execution-service-under-test.js';

const JOB_ID = randomUUID();
const MESSAGE_ID = randomUUID();
const ENTRY = { jobId: JOB_ID, run: 1, attempt: 1 };
const AT = { run: 1, attempt: 1 };
const EMAIL = { sendMs: 150, messageId: MESSAGE_ID };
const SIGNAL = expect.any(AbortSignal) as AbortSignal;
const COMPLETED = { status: 'completed', result: { messageId: MESSAGE_ID }, ...AT } as const;

describe('job-execution-service running jobs', () => {
  let service: JobExecutionServiceUnderTest;
  /** A second app a shutdown test starts; closed after the test if the test did not get to it. */
  let stopping: JobExecutionServiceUnderTest | undefined;

  /** The whole run of the pending email job, up to the accepted completion. */
  const runsToCompletion = (): void => {
    service.readAndStart(service.emailJob({ id: JOB_ID }));
    service.sendsEmail(EMAIL);
    service.acceptsReport(service.emailJob({ id: JOB_ID, status: 'completed', attempts: 1 }));
  };

  beforeAll(async () => {
    service = await JobExecutionServiceUnderTest.start();
  });
  beforeEach(() => {
    service.clear();
  });
  afterEach(async () => {
    if (stopping === undefined) return;
    const app = stopping;
    stopping = undefined;
    app.stubIdleShutdown();
    await app.close().catch(() => undefined);
  });
  afterAll(async () => {
    service.stubIdleShutdown();
    await service.close();
  });

  describe('running and reporting', () => {
    it('Pending job runs to completion', async () => {
      runsToCompletion();

      await service.run(ENTRY);

      expect(service.jobs.get).toHaveBeenCalledExactlyOnceWith({ id: JOB_ID, signal: SIGNAL });
      expect(service.jobs.update.mock.calls).toEqual([
        [{ id: JOB_ID, update: { status: 'processing', ...AT }, signal: SIGNAL }],
        [{ id: JOB_ID, update: COMPLETED, signal: SIGNAL }],
      ]);
    });

    it('Run of an attempt is logged', async () => {
      runsToCompletion();

      await service.run(ENTRY);

      const lines = service.jobLog.write.mock.calls.map(
        ([line]) => JSON.parse(line) as Record<string, unknown>,
      );
      const steps = lines.filter((line) => line.jobId === JOB_ID);
      expect(steps.map((line) => line.msg)).toEqual(
        expect.arrayContaining([
          'Attempt picked up',
          'Handler started',
          'Handler finished',
          'Job completed',
        ]),
      );
      for (const msg of [
        'Attempt picked up',
        'Handler started',
        'Handler finished',
        'Job completed',
      ]) {
        expect(steps.find((line) => line.msg === msg)).toMatchObject({
          jobId: JOB_ID,
          attempt: 1,
          instanceId: INSTANCE_ID,
        });
      }
      expect(steps.find((line) => line.msg === 'Handler finished')).toMatchObject({
        durationMs: expect.any(Number) as number,
      });
    });

    // One finished status is enough here; the unit test goes through every status that skips.
    it('Job already taken or finished', async () => {
      service.jobs.get.mockResolvedValueOnce({
        job: service.emailJob({ id: JOB_ID, status: 'completed', attempts: 1 }),
        maxProcessingMs: TEST_CONFIG.maxProcessingMs,
      });

      await service.run(ENTRY);

      expect(service.jobs.update).not.toHaveBeenCalled();
      expect(service.handlerRan()).toBe(false);
    });

    it('Job deleted', async () => {
      service.jobs.get.mockRejectedValueOnce(new JobNotFoundError({ id: JOB_ID }));

      await service.run(ENTRY);

      expect(service.jobs.update).not.toHaveBeenCalled();
      expect(service.handlerRan()).toBe(false);
    });

    it('Another worker started the job first', async () => {
      service.jobs.get.mockResolvedValueOnce({
        job: service.emailJob({ id: JOB_ID }),
        maxProcessingMs: TEST_CONFIG.maxProcessingMs,
      });
      service.jobs.update.mockRejectedValueOnce(new JobStatusConflictError({ id: JOB_ID }));

      await service.run(ENTRY);

      expect(service.reports()).toEqual([{ status: 'processing', ...AT }]);
      expect(service.handlerRan()).toBe(false);
      const skipped = service.jobLogs(JOB_ID).filter((line) => line.msg?.includes('Skipped'));
      expect(skipped).toEqual([expect.objectContaining({ level: 30, attempt: 1 })]);
      expect(service.logs.filter((line) => line.level >= 40)).toEqual([]);
    });

    it('Invalid payload', async () => {
      const issues = [
        { code: 'invalid_format', path: ['payload', 'to'], message: 'Invalid email' },
      ];
      service.jobs.get.mockRejectedValueOnce(new InvalidJobError({ id: JOB_ID, issues }));
      service.acceptsReport(service.emailJob({ id: JOB_ID, status: 'processing', attempts: 1 }));
      service.acceptsReport(service.emailJob({ id: JOB_ID, attempts: 1 }));

      await service.run(ENTRY);

      expect(service.reports()).toEqual([
        { status: 'processing', ...AT },
        {
          status: 'failed',
          error: expect.objectContaining({ code: 'INVALID_PAYLOAD' }) as unknown,
          ...AT,
        },
      ]);
      expect(service.handlerRan()).toBe(false);
    });

    it('Report succeeds after a retry', async () => {
      service.readAndStart(service.emailJob({ id: JOB_ID }));
      service.sendsEmail(EMAIL);
      service.jobs.update.mockRejectedValueOnce(new JobServiceUnavailableError({ reason: '503' }));
      service.acceptsReport(service.emailJob({ id: JOB_ID, status: 'completed', attempts: 1 }));

      await service.run(ENTRY);

      expect(service.reports()).toEqual([{ status: 'processing', ...AT }, COMPLETED, COMPLETED]);
      expect(service.jobLogs(JOB_ID)).toContainEqual(
        expect.objectContaining({ msg: 'Job completed' }),
      );
    });

    it('Report keeps failing', async () => {
      service.readAndStart(service.emailJob({ id: JOB_ID }));
      service.sendsEmail(EMAIL);
      for (let tries = 0; tries <= TEST_CONFIG.reportRetries; tries += 1) {
        service.jobs.update.mockRejectedValueOnce(
          new JobServiceUnavailableError({ reason: '503' }),
        );
      }

      await service.run(ENTRY);

      // The first try and the configured number of retries, then no more.
      expect(service.reports()).toEqual([
        { status: 'processing', ...AT },
        ...Array.from({ length: TEST_CONFIG.reportRetries + 1 }, () => COMPLETED),
      ]);
      expect(service.jobLogs(JOB_ID).filter((line) => line.level === 50)).toEqual([
        expect.objectContaining({
          attempt: 1,
          status: 'completed',
          msg: expect.stringContaining('Gave up reporting') as unknown,
        }),
      ]);
      expect(service.jobLogs(JOB_ID)).not.toContainEqual(
        expect.objectContaining({ msg: 'Job completed' }),
      );
    });

    it('Logs of a completed job', async () => {
      runsToCompletion();

      await service.run(ENTRY);

      const lines = service.jobLogs(JOB_ID);
      expect(lines.map((line) => line.msg)).toEqual([
        'Attempt picked up',
        'Job started',
        'Handler started',
        'Handler finished',
        'Job completed',
      ]);
      for (const line of lines) {
        expect(line).toMatchObject({ jobId: JOB_ID, attempt: 1, instanceId: INSTANCE_ID });
      }
    });
  });

  describe('cancellation', () => {
    /** The email job starts sending and its send lasts until it is aborted. */
    const sendsUntilAborted = (jobId: string): void => {
      service.readAndStart(service.emailJob({ id: jobId }));
      service.random.int.mockReturnValueOnce({ value: EMAIL.sendMs });
      service.sleepsUntilAborted();
    };

    it('Running job is cancelled', async () => {
      sendsUntilAborted(JOB_ID);
      const running = service.run(ENTRY);
      await vi.waitFor(() => {
        expect(service.sleeper.sleep).toHaveBeenCalledOnce();
      });

      service.announceCancel(JOB_ID);

      await expect(running).resolves.toEqual({ outcome: 'cancelled' });
      expect(service.reports()).toEqual([{ status: 'processing', ...AT }]);
      expect(service.jobLogs(JOB_ID)).toContainEqual(
        expect.objectContaining({
          level: 30,
          jobId: JOB_ID,
          attempt: 1,
          instanceId: INSTANCE_ID,
          msg: expect.stringContaining('cancelled') as unknown,
        }),
      );
      expect(service.logs.filter((line) => line.level >= 40)).toEqual([]);
    });

    it('Cancellation of a job this worker does not run', async () => {
      runsToCompletion();
      const running = service.run(ENTRY);

      service.announceCancel(randomUUID());

      await expect(running).resolves.toEqual({ outcome: 'completed' });
      expect(service.reports()).toEqual([{ status: 'processing', ...AT }, COMPLETED]);
    });
  });

  describe('the maximum processing time and recovered attempts', () => {
    /** A time limit far below the email send time; the timer is real, the send never ends. */
    const SHORT_LIMIT_MS = 30;

    it('Handler exceeds the time limit', async () => {
      service.readAndStartWithin({
        job: service.emailJob({ id: JOB_ID }),
        maxProcessingMs: SHORT_LIMIT_MS,
      });
      service.random.int.mockReturnValueOnce({ value: EMAIL.sendMs });
      service.sleepsUntilAborted();
      service.acceptsReport(service.emailJob({ id: JOB_ID, status: 'failed', attempts: 1 }));

      await expect(service.run(ENTRY)).resolves.toEqual({ outcome: 'failed' });

      expect(service.reports()).toEqual([
        { status: 'processing', ...AT },
        {
          status: 'failed',
          error: {
            code: 'JOB_TIMEOUT',
            message: expect.stringContaining(String(SHORT_LIMIT_MS)) as unknown,
            details: { maxProcessingMs: SHORT_LIMIT_MS },
          },
          ...AT,
        },
      ]);
      expect(service.jobLogs(JOB_ID)).toContainEqual(
        expect.objectContaining({ level: 40, code: 'JOB_TIMEOUT', attempt: 1 }),
      );
    });

    it('Completion refused after a recovery', async () => {
      service.readAndStart(service.emailJob({ id: JOB_ID }));
      service.sendsEmail(EMAIL);
      service.jobs.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'scheduled' }),
      );

      await expect(service.run(ENTRY)).resolves.toEqual({ outcome: 'skipped' });

      expect(service.reports()).toEqual([{ status: 'processing', ...AT }, COMPLETED]);
      expect(service.jobLogs(JOB_ID).filter((line) => line.level >= 40)).toEqual([
        expect.objectContaining({
          level: 40,
          jobId: JOB_ID,
          run: 1,
          attempt: 1,
          instanceId: INSTANCE_ID,
          msg: expect.stringContaining('recovered') as unknown,
        }),
      ]);
    });

    it('Job running during shutdown', async () => {
      const app = await JobExecutionServiceUnderTest.start();
      stopping = app;
      app.readAndStart(app.emailJob({ id: JOB_ID }));
      let finishSending = (): void => undefined;
      app.random.int.mockReturnValueOnce({ value: EMAIL.sendMs });
      app.sleeper.sleep.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSending = () => {
              resolve({});
            };
          }),
      );
      app.random.uuid.mockReturnValueOnce({ value: MESSAGE_ID });
      app.acceptsReport(app.emailJob({ id: JOB_ID, status: 'completed', attempts: 1 }));
      const running = app.run(ENTRY);
      await vi.waitFor(() => {
        expect(app.sleeper.sleep).toHaveBeenCalledOnce();
      });
      // Like the real consumer, closing stops taking entries and waits for the running ones.
      app.consumer.close.mockImplementationOnce(async () => {
        await running;
        return {};
      });
      app.sleepsUntilAborted();

      const closing = app.close();
      await vi.waitFor(() => {
        expect(app.consumer.close).toHaveBeenCalledOnce();
      });
      finishSending();
      await closing;
      stopping = undefined;

      expect(app.sleeper.sleep).toHaveBeenLastCalledWith({
        ms: TEST_CONFIG.shutdownGraceMs,
        signal: SIGNAL,
      });
      expect(app.reports()).toEqual([{ status: 'processing', ...AT }, COMPLETED]);
      expect(app.logs.filter((line) => line.level >= 40)).toEqual([]);
    });

    it('Job cancelled during the shutdown grace period', async () => {
      const app = await JobExecutionServiceUnderTest.start();
      stopping = app;
      app.readAndStart(app.emailJob({ id: JOB_ID }));
      app.random.int.mockReturnValueOnce({ value: EMAIL.sendMs });
      app.sleepsUntilAborted();
      const running = app.run(ENTRY);
      await vi.waitFor(() => {
        expect(app.sleeper.sleep).toHaveBeenCalledOnce();
      });
      app.consumer.close.mockImplementationOnce(async () => {
        await running;
        return {};
      });
      app.cancellations.close.mockResolvedValueOnce({});
      app.sleepsUntilAborted();

      const closing = app.close();
      await vi.waitFor(() => {
        expect(app.consumer.close).toHaveBeenCalledOnce();
      });
      app.announceCancel(JOB_ID);
      await closing;
      stopping = undefined;

      await expect(running).resolves.toEqual({ outcome: 'cancelled' });
      expect(app.reports()).toEqual([{ status: 'processing', ...AT }]);
      expect(app.cancellations.close).toHaveBeenCalledOnce();
      expect(app.consumer.close.mock.invocationCallOrder[0]).toBeLessThan(
        app.cancellations.close.mock.invocationCallOrder[0] ?? 0,
      );
      expect(app.logs.filter((line) => line.level >= 40)).toEqual([]);
    });

    it('Grace period runs out', async () => {
      const app = await JobExecutionServiceUnderTest.start();
      stopping = app;
      app.readAndStart(app.emailJob({ id: JOB_ID }));
      app.random.int.mockReturnValueOnce({ value: EMAIL.sendMs });
      // The send never finishes by itself.
      app.sleepsUntilAborted();
      const running = app.run(ENTRY);
      await vi.waitFor(() => {
        expect(app.sleeper.sleep).toHaveBeenCalledOnce();
      });
      app.consumer.close.mockImplementationOnce(async () => {
        await running;
        return {};
      });
      // The grace period is over at once.
      app.sleeper.sleep.mockResolvedValueOnce({});

      await app.close();
      stopping = undefined;

      expect(app.sleeper.sleep).toHaveBeenLastCalledWith({
        ms: TEST_CONFIG.shutdownGraceMs,
        signal: SIGNAL,
      });
      expect(app.reports()).toEqual([{ status: 'processing', ...AT }]);
      expect(app.logs.filter((line) => line.level === 40)).toEqual([
        expect.objectContaining({
          msg: expect.stringContaining('grace period is over') as unknown,
        }),
        expect.objectContaining({
          jobId: JOB_ID,
          msg: expect.stringContaining('Abandoned') as unknown,
        }),
      ]);
    });
  });
});
