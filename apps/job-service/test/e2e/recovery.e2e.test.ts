import { JOB_ERROR_CODES, type Job } from '@job-queue/contracts';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JOB_RECOVERY_INTERVAL_NAME } from '../../src/app/jobs/job-recovery-schedule.js';

import { JobQueueUnavailableError } from '../../src/domain/jobs/errors/job-queue-unavailable.error.js';
import { JobServiceUnderTest, TEST_CONFIG } from './job-service-under-test.js';

const EMAIL_JOB = {
  type: 'email',
  priority: 8,
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
};
const RESULT = { messageId: 'm-1' };
/** Older than the configured minimum age, so a pass looks at the job. */
const STUCK_FOR_MS = TEST_CONFIG.recoveryMinAgeMs * 3;
/** A start longer ago than the email limit plus the recovery interval: timed out. */
const TIMED_OUT_FOR_MS = TEST_CONFIG.maxProcessingMsEmail + TEST_CONFIG.recoveryIntervalMs * 2;

describe('job-service recovery pass', () => {
  let service: JobServiceUnderTest;

  /** A job a worker started through the internal route (its first attempt), then left. */
  const startedJob = async (maxAttempts = 3): Promise<Job> => {
    const job = await service.submitted({ ...EMAIL_JOB, maxAttempts });
    const response = await service.report({
      id: job.id,
      body: { status: 'processing', run: 1, attempt: 1 },
    });
    expect(response.status).toBe(200);
    return job;
  };
  /** The entries put on the queue after the job's submission (its first attempt). */
  const enqueuedAfterSubmit = (jobId: string): unknown[] =>
    service.queue.enqueue.mock.calls
      .map(([request]) => request)
      .filter((request) => request.jobId === jobId && request.attempt > 1);

  beforeAll(async () => {
    service = await JobServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterAll(async () => {
    await service.close();
  });

  it('Pending job whose queueing failed is queued again', async () => {
    service.queue.enqueue.mockRejectedValueOnce(
      new JobQueueUnavailableError({ jobId: 'x', run: 1, attempt: 1 }),
    );
    const job = await service.submitted(EMAIL_JOB);
    await service.age({ id: job.id, changedAgoMs: STUCK_FOR_MS });
    service.queue.state.mockResolvedValueOnce({ state: 'missing' });
    service.queue.enqueue.mockResolvedValueOnce({});

    await expect(service.recover()).resolves.toEqual({
      requeued: 1,
      lostWorkers: 0,
      timedOut: 0,
    });

    expect(service.queue.state).toHaveBeenCalledExactlyOnceWith({
      jobId: job.id,
      run: 1,
      attempt: 1,
    });
    // The submission's failed try, then the recovery's: the same attempt, queued again.
    const firstAttempt = { jobId: job.id, run: 1, attempt: 1, priority: 8, runAt: null };
    expect(service.queue.enqueue.mock.calls).toEqual([[firstAttempt], [firstAttempt]]);
    expect(await service.stored(job.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('Young jobs are left alone: a pending job with no entry, changed less than the minimum age ago', async () => {
    service.queue.enqueue.mockRejectedValueOnce(
      new JobQueueUnavailableError({ jobId: 'x', run: 1, attempt: 1 }),
    );
    const job = await service.submitted(EMAIL_JOB);
    await service.age({ id: job.id, changedAgoMs: TEST_CONFIG.recoveryMinAgeMs / 2 });

    await expect(service.recover()).resolves.toEqual({
      requeued: 0,
      lostWorkers: 0,
      timedOut: 0,
    });

    expect(service.queue.state).not.toHaveBeenCalled();
    expect(service.queue.enqueue).toHaveBeenCalledOnce();
    expect(await service.stored(job.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('Recovery runs at the configured interval: the running app registers the recovery timer', () => {
    expect(service.app.get(SchedulerRegistry).getIntervals()).toContain(JOB_RECOVERY_INTERVAL_NAME);
  });

  it('Due scheduled job with no entry is queued again', async () => {
    const job = await service.seed({ status: 'scheduled' });
    await service.age({ id: job.id, changedAgoMs: STUCK_FOR_MS, dueAgoMs: STUCK_FOR_MS });
    const { scheduledAt } = await service.stored(job.id);
    service.queue.state.mockResolvedValueOnce({ state: 'missing' });
    service.queue.enqueue.mockResolvedValueOnce({});

    await expect(service.recover()).resolves.toMatchObject({ requeued: 1 });

    expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
      jobId: job.id,
      run: 1,
      attempt: 1,
      priority: 5,
      runAt: scheduledAt,
    });
    expect(await service.stored(job.id)).toMatchObject({ status: 'scheduled', attempts: 0 });
  });

  it('Scheduled job not yet due is left alone', async () => {
    const job = await service.seed({ status: 'scheduled' });
    await service.age({ id: job.id, changedAgoMs: STUCK_FOR_MS });

    await expect(service.recover()).resolves.toEqual({
      requeued: 0,
      lostWorkers: 0,
      timedOut: 0,
    });

    expect(service.queue.state).not.toHaveBeenCalled();
    expect(service.queue.enqueue).not.toHaveBeenCalled();
  });

  it('Lost worker with attempts left', async () => {
    const job = await startedJob();
    await service.age({ id: job.id, changedAgoMs: STUCK_FOR_MS, startedAgoMs: STUCK_FOR_MS });
    service.queue.state.mockResolvedValueOnce({ state: 'waiting' });
    service.queue.enqueue.mockResolvedValueOnce({});
    const before = Date.now();

    await expect(service.recover()).resolves.toMatchObject({ lostWorkers: 1 });

    const after = Date.now();
    const recovered = await service.stored(job.id);
    expect(recovered).toMatchObject({
      status: 'scheduled',
      attempts: 1,
      error: { code: JOB_ERROR_CODES.workerLost },
      completedAt: null,
    });
    // The first retry's delay, counted from the moment of the recovery.
    const scheduledAt = Date.parse(recovered.scheduledAt ?? '');
    expect(scheduledAt).toBeGreaterThanOrEqual(before + TEST_CONFIG.retryMinDelayMs);
    expect(scheduledAt).toBeLessThanOrEqual(after + TEST_CONFIG.retryMaxDelayMs);
    expect(enqueuedAfterSubmit(job.id)).toEqual([
      { jobId: job.id, run: 1, attempt: 2, priority: 8, runAt: recovered.scheduledAt },
    ]);
  });

  it('Lost worker on the last attempt', async () => {
    const job = await startedJob(1);
    await service.age({ id: job.id, changedAgoMs: STUCK_FOR_MS, startedAgoMs: STUCK_FOR_MS });
    service.queue.state.mockResolvedValueOnce({ state: 'finished' });

    await expect(service.recover()).resolves.toMatchObject({ lostWorkers: 1 });

    const recovered = await service.stored(job.id);
    expect(recovered).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: { code: JOB_ERROR_CODES.workerLost },
    });
    expect(recovered.completedAt).toEqual(expect.any(String));
    expect(enqueuedAfterSubmit(job.id)).toEqual([]);
  });

  it('Processing job whose entry is missing is left to the time limit', async () => {
    const job = await startedJob();
    await service.age({ id: job.id, changedAgoMs: STUCK_FOR_MS, startedAgoMs: STUCK_FOR_MS });
    const before = await service.stored(job.id);
    service.queue.state.mockResolvedValueOnce({ state: 'missing' });

    await expect(service.recover()).resolves.toEqual({
      requeued: 0,
      lostWorkers: 0,
      timedOut: 0,
    });

    expect(await service.stored(job.id)).toEqual(before);
  });

  it('Timed-out job on the last attempt', async () => {
    const job = await startedJob(1);
    await service.age({
      id: job.id,
      changedAgoMs: TIMED_OUT_FOR_MS,
      startedAgoMs: TIMED_OUT_FOR_MS,
    });

    await expect(service.recover()).resolves.toMatchObject({ timedOut: 1 });

    const recovered = await service.stored(job.id);
    expect(recovered).toMatchObject({
      status: 'failed',
      error: {
        code: JOB_ERROR_CODES.jobTimeout,
        details: { maxProcessingMs: TEST_CONFIG.maxProcessingMsEmail },
      },
    });
    expect(recovered.completedAt).toEqual(expect.any(String));
    expect(service.queue.state).not.toHaveBeenCalled();
  });

  it('Two recovery passes at the same time: the lost attempt is failed and requeued once', async () => {
    const job = await startedJob();
    await service.age({ id: job.id, changedAgoMs: STUCK_FOR_MS, startedAgoMs: STUCK_FOR_MS });
    // A barrier: neither pass gets its entry's state until both have read the job as processing,
    // so both decide to recover it before either writes.
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waitForBoth = async (): Promise<{ state: 'waiting' }> => {
      arrived += 1;
      if (arrived === 2) release();
      await bothRead;
      return { state: 'waiting' };
    };
    service.queue.state.mockImplementationOnce(waitForBoth).mockImplementationOnce(waitForBoth);
    service.queue.enqueue.mockResolvedValueOnce({});

    const passes = await Promise.all([service.recover(), service.recover()]);

    expect(service.queue.state).toHaveBeenCalledTimes(2);
    expect(passes.map((pass) => pass.lostWorkers).sort()).toEqual([0, 1]);
    expect(await service.stored(job.id)).toMatchObject({
      status: 'scheduled',
      attempts: 1,
      error: { code: JOB_ERROR_CODES.workerLost },
    });
    expect(enqueuedAfterSubmit(job.id)).toHaveLength(1);
  });

  it('Worker report lands first: the job is completed and no WORKER_LOST is stored', async () => {
    const job = await startedJob();
    await service.age({ id: job.id, changedAgoMs: STUCK_FOR_MS, startedAgoMs: STUCK_FOR_MS });
    // The worker's completion arrives after the pass read the job, before it writes its change.
    service.queue.state.mockImplementationOnce(async () => {
      const response = await service.report({
        id: job.id,
        body: { status: 'completed', run: 1, attempt: 1, result: RESULT },
      });
      expect(response.status).toBe(200);
      return { state: 'finished' };
    });

    await expect(service.recover()).resolves.toEqual({
      requeued: 0,
      lostWorkers: 0,
      timedOut: 0,
    });

    expect(await service.stored(job.id)).toMatchObject({
      status: 'completed',
      result: RESULT,
      error: null,
    });
    expect(enqueuedAfterSubmit(job.id)).toEqual([]);
  });
});
