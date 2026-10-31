import { randomUUID } from 'node:crypto';

import {
  type EmailJob,
  type FlightTransitJob,
  type Job,
  JOB_ERROR_CODES,
  type JobType,
} from '@job-queue/contracts';
import { type Clock, JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import { JobQueueUnavailableError } from '../../../domain/jobs/errors/job-queue-unavailable.error.js';
import type { JobQueue, JobQueueEntryState } from '../../../domain/jobs/job-queue.js';
import type { JobRepository, StoredJob } from '../../../domain/jobs/job-repository.js';
import type { JobService } from '../../../domain/jobs/job-service.js';
import { JobRecoveryImpl } from './job-recovery.impl.js';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const MIN_AGE_MS = 30_000;
const INTERVAL_MS = 30_000;
const BATCH_SIZE = 100;
const MAX_PROCESSING_MS: Readonly<Record<JobType, number>> = {
  email: 30_000,
  webhook: 30_000,
  'flight-transit': 60_000,
};
/** The instant a job must have been in its state since for the pass to look at it. */
const BEFORE = new Date(NOW.getTime() - MIN_AGE_MS);
/** A start the time limit (plus one interval) has not passed yet. */
const RECENT_START = new Date(NOW.getTime() - 45_000).toISOString();
/** A start older than the email limit plus one interval. */
const TIMED_OUT_START = new Date(
  NOW.getTime() - MAX_PROCESSING_MS.email - INTERVAL_MS - 1,
).toISOString();

describe('JobRecoveryImpl', () => {
  let repository: DeepMockProxy<JobRepository>;
  let queue: DeepMockProxy<JobQueue>;
  let jobs: DeepMockProxy<JobService>;
  let clock: DeepMockProxy<Clock>;
  let logger: DeepMockProxy<Pick<LoggerService, 'log' | 'warn'>>;
  let recovery: JobRecoveryImpl;

  const emailJob = (overrides: Partial<EmailJob> = {}): EmailJob => ({
    id: randomUUID(),
    type: 'email',
    status: 'pending',
    priority: 7,
    attempts: 0,
    maxAttempts: 3,
    payload: { to: 'ops@acme.test', subject: 'Weekly digest', body: 'Hi team' },
    result: null,
    error: null,
    groupId: null,
    idempotencyKey: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(NOW.getTime() - 120_000).toISOString(),
    updatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    ...overrides,
  });
  const stored = (job: Job, run = 1): StoredJob => ({ job, run, requestFingerprint: null });
  const processing = (overrides: Partial<EmailJob> = {}): EmailJob =>
    emailJob({ status: 'processing', attempts: 1, startedAt: RECENT_START, ...overrides });
  /** A processing flight transit job: its type's limit is not the email one. */
  const processingTransit = (startedAt: string): FlightTransitJob => {
    const {
      payload: _payload,
      result: _result,
      type: _type,
      ...common
    } = processing({ startedAt });
    return {
      ...common,
      type: 'flight-transit',
      payload: { origin: 'LHR', destination: 'JFK', departureDate: '2030-06-15' },
      result: null,
    };
  };

  /** One pass that reads `waiting` and `running` jobs, and finds their entries in `states`. */
  const givenJobs = (req: { waiting?: StoredJob[]; running?: StoredJob[] }): void => {
    repository.findWaitingSince.mockResolvedValueOnce({ jobs: req.waiting ?? [] });
    repository.findProcessingSince.mockResolvedValueOnce({ jobs: req.running ?? [] });
  };
  const givenState = (state: JobQueueEntryState): void => {
    queue.state.mockResolvedValueOnce({ state });
  };

  beforeEach(() => {
    repository = mockDeep<JobRepository>();
    queue = mockDeep<JobQueue>();
    jobs = mockDeep<JobService>();
    clock = mockDeep<Clock>();
    logger = mockDeep<Pick<LoggerService, 'log' | 'warn'>>();
    clock.now.mockReturnValueOnce({ now: NOW });
    recovery = new JobRecoveryImpl(
      { repository, queue, jobs, clock, logger },
      {
        minAgeMs: MIN_AGE_MS,
        intervalMs: INTERVAL_MS,
        batchSize: BATCH_SIZE,
        maxProcessingMs: MAX_PROCESSING_MS,
      },
    );
  });

  it('Young jobs are left alone: only jobs in their state since now minus the minimum age are read', async () => {
    givenJobs({});

    await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 0 });

    expect(repository.findWaitingSince).toHaveBeenCalledExactlyOnceWith({
      before: BEFORE,
      limit: BATCH_SIZE,
    });
    expect(repository.findProcessingSince).toHaveBeenCalledExactlyOnceWith({
      before: BEFORE,
      limit: BATCH_SIZE,
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(jobs.update).not.toHaveBeenCalled();
  });

  describe('a waiting job', () => {
    it('Pending job whose queueing failed is queued again: its next attempt with its priority, at once', async () => {
      const job = emailJob();
      givenJobs({ waiting: [stored(job)] });
      givenState('missing');
      queue.enqueue.mockResolvedValueOnce({});

      await expect(recovery.run()).resolves.toEqual({ requeued: 1, lostWorkers: 0, timedOut: 0 });

      expect(queue.state).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, run: 1, attempt: 1 });
      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: 7,
        runAt: null,
      });
      expect(queue.requeue).not.toHaveBeenCalled();
      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('Due scheduled job with no entry is queued again: at its scheduled time, in its run', async () => {
      const scheduledAt = new Date(NOW.getTime() - 40_000).toISOString();
      const job = emailJob({ status: 'scheduled', attempts: 1, scheduledAt });
      givenJobs({ waiting: [stored(job, 2)] });
      givenState('missing');
      queue.enqueue.mockResolvedValueOnce({});

      await recovery.run();

      expect(queue.state).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, run: 2, attempt: 2 });
      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 2,
        attempt: 2,
        priority: 7,
        runAt: scheduledAt,
      });
    });

    it.each(['waiting', 'delayed', 'active'] as const)(
      'Waiting job with a live entry is left alone: entry %s',
      async (state) => {
        givenJobs({ waiting: [stored(emailJob())] });
        givenState(state);

        await expect(recovery.run()).resolves.toEqual({
          requeued: 0,
          lostWorkers: 0,
          timedOut: 0,
        });

        expect(queue.enqueue).not.toHaveBeenCalled();
        expect(queue.requeue).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
      },
    );

    it('Finished entry of a waiting job is replaced', async () => {
      const job = emailJob();
      givenJobs({ waiting: [stored(job)] });
      givenState('finished');
      queue.requeue.mockResolvedValueOnce({});

      await expect(recovery.run()).resolves.toEqual({ requeued: 1, lostWorkers: 0, timedOut: 0 });

      expect(queue.requeue).toHaveBeenCalledExactlyOnceWith({
        jobId: job.id,
        run: 1,
        attempt: 1,
        priority: 7,
        runAt: null,
      });
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('a processing job', () => {
    it.each([
      { name: 'Lost worker with attempts left', state: 'waiting' as const, attempts: 1 },
      { name: 'Lost worker on the last attempt', state: 'finished' as const, attempts: 3 },
      { name: 'Lost start report', state: 'finished' as const, attempts: 2 },
      { name: 'an entry back in the delayed set', state: 'delayed' as const, attempts: 1 },
    ])(
      '$name: the attempt fails with WORKER_LOST through the job service',
      async ({ state, attempts }) => {
        const job = processing({ attempts });
        givenJobs({ running: [stored(job, 2)] });
        givenState(state);
        jobs.update.mockResolvedValueOnce({ job: { ...job, status: 'scheduled' } });

        await expect(recovery.run()).resolves.toEqual({
          requeued: 0,
          lostWorkers: 1,
          timedOut: 0,
        });

        expect(queue.state).toHaveBeenCalledExactlyOnceWith({
          jobId: job.id,
          run: 2,
          attempt: attempts,
        });
        expect(jobs.update).toHaveBeenCalledExactlyOnceWith({
          id: job.id,
          update: {
            status: 'failed',
            error: expect.objectContaining({ code: JOB_ERROR_CODES.workerLost }) as unknown,
            run: 2,
            attempt: attempts,
          },
        });
      },
    );

    it('Processing job whose entry is being run is left alone', async () => {
      givenJobs({ running: [stored(processing())] });
      givenState('active');

      await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 0 });

      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('Processing job whose entry is missing is left to the time limit', async () => {
      givenJobs({ running: [stored(processing())] });
      givenState('missing');

      await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 0 });

      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('Timed-out job with attempts left: fails with JOB_TIMEOUT, whatever its entry', async () => {
      const job = processing({ startedAt: TIMED_OUT_START });
      givenJobs({ running: [stored(job)] });
      jobs.update.mockResolvedValueOnce({ job: { ...job, status: 'scheduled' } });

      await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 1 });

      expect(queue.state).not.toHaveBeenCalled();
      expect(jobs.update).toHaveBeenCalledExactlyOnceWith({
        id: job.id,
        update: {
          status: 'failed',
          error: expect.objectContaining({
            code: JOB_ERROR_CODES.jobTimeout,
            details: { maxProcessingMs: MAX_PROCESSING_MS.email },
          }) as unknown,
          run: 1,
          attempt: 1,
        },
      });
    });

    it('Job within its time is left alone: a type is judged by its own limit, not the email one', async () => {
      const pastTheEmailLimit = new Date(
        NOW.getTime() - MAX_PROCESSING_MS.email - INTERVAL_MS - 1,
      ).toISOString();
      givenJobs({ running: [stored(processingTransit(pastTheEmailLimit))] });
      givenState('active');

      await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 0 });

      expect(jobs.update).not.toHaveBeenCalled();
    });

    it('Timed-out job with attempts left: past its own type limit a transit fails with that limit', async () => {
      const job = processingTransit(
        new Date(
          NOW.getTime() - MAX_PROCESSING_MS['flight-transit'] - INTERVAL_MS - 1,
        ).toISOString(),
      );
      givenJobs({ running: [stored(job)] });
      jobs.update.mockResolvedValueOnce({ job });

      await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 1 });

      expect(jobs.update).toHaveBeenCalledExactlyOnceWith({
        id: job.id,
        update: {
          status: 'failed',
          error: expect.objectContaining({
            code: JOB_ERROR_CODES.jobTimeout,
            details: { maxProcessingMs: MAX_PROCESSING_MS['flight-transit'] },
          }) as unknown,
          run: 1,
          attempt: 1,
        },
      });
    });

    it('Job within its time is left alone: exactly at the limit plus one interval it is not timed out yet', async () => {
      const atTheLimit = new Date(
        NOW.getTime() - MAX_PROCESSING_MS.email - INTERVAL_MS,
      ).toISOString();
      givenJobs({ running: [stored(processing({ startedAt: atTheLimit }))] });
      givenState('active');

      await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 0 });

      expect(jobs.update).not.toHaveBeenCalled();
    });

    it.each([
      { name: 'Worker report lands first', refusal: () => new JobStatusConflictError({ id: 'x' }) },
      { name: 'the job was deleted meanwhile', refusal: () => new JobNotFoundError({ id: 'x' }) },
    ])(
      '$name: the refused recovery counts as nothing and is logged at info',
      async ({ refusal }) => {
        const job = processing();
        givenJobs({ running: [stored(job)] });
        givenState('finished');
        jobs.update.mockRejectedValueOnce(refusal());

        await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 0 });

        expect(logger.log).toHaveBeenCalledWith(
          expect.objectContaining({ jobId: job.id, run: 1, attempt: 1 }),
          expect.any(String),
        );
        expect(logger.warn).not.toHaveBeenCalled();
      },
    );

    it('lets an unexpected failure of the job service end the pass', async () => {
      givenJobs({ running: [stored(processing())] });
      givenState('finished');
      jobs.update.mockRejectedValueOnce(new Error('database gone'));

      await expect(recovery.run()).rejects.toThrow('database gone');
    });
  });

  it('Recovery is logged: a warn line with the job id, run, attempt and reason for each recovery', async () => {
    const waiting = emailJob();
    const lost = processing();
    const timedOut = processing({ startedAt: TIMED_OUT_START });
    givenJobs({ waiting: [stored(waiting)], running: [stored(lost), stored(timedOut)] });
    givenState('missing');
    queue.enqueue.mockResolvedValueOnce({});
    givenState('waiting');
    jobs.update.mockResolvedValueOnce({ job: lost });
    jobs.update.mockResolvedValueOnce({ job: timedOut });

    await expect(recovery.run()).resolves.toEqual({ requeued: 1, lostWorkers: 1, timedOut: 1 });

    expect(logger.warn.mock.calls).toEqual([
      [
        { jobId: waiting.id, run: 1, attempt: 1, reason: 'no live queue entry' },
        expect.any(String),
      ],
      [
        { jobId: lost.id, run: 1, attempt: 1, reason: JOB_ERROR_CODES.workerLost },
        expect.any(String),
      ],
      [
        { jobId: timedOut.id, run: 1, attempt: 1, reason: JOB_ERROR_CODES.jobTimeout },
        expect.any(String),
      ],
    ]);
  });

  it('ends the pass with one warn line when the queue cannot be reached', async () => {
    const first = emailJob();
    repository.findWaitingSince.mockResolvedValueOnce({
      jobs: [stored(first), stored(emailJob())],
    });
    queue.state.mockRejectedValueOnce(
      new JobQueueUnavailableError({ jobId: first.id, run: 1, attempt: 1 }),
    );

    await expect(recovery.run()).resolves.toEqual({ requeued: 0, lostWorkers: 0, timedOut: 0 });

    expect(queue.state).toHaveBeenCalledOnce();
    expect(repository.findProcessingSince).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it.each(['enqueue', 'requeue'] as const)(
    'ends the pass with one warn line when %s cannot reach the queue',
    async (call) => {
      givenJobs({ waiting: [stored(emailJob())] });
      givenState(call === 'enqueue' ? 'missing' : 'finished');
      queue[call].mockRejectedValueOnce(
        new JobQueueUnavailableError({ jobId: randomUUID(), run: 1, attempt: 1 }),
      );

      await expect(recovery.run()).resolves.toEqual({
        requeued: 0,
        lostWorkers: 0,
        timedOut: 0,
      });

      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(JobQueueUnavailableError) as unknown }),
        expect.stringMatching(/^Recovery pass stopped/),
      );
      expect(repository.findProcessingSince).not.toHaveBeenCalled();
    },
  );

  it('keeps what it recovered before the queue became unreachable', async () => {
    givenJobs({ waiting: [stored(emailJob())], running: [stored(processing())] });
    givenState('missing');
    queue.enqueue.mockResolvedValueOnce({});
    queue.state.mockRejectedValueOnce(
      new JobQueueUnavailableError({ jobId: randomUUID(), run: 1, attempt: 1 }),
    );

    await expect(recovery.run()).resolves.toEqual({ requeued: 1, lostWorkers: 0, timedOut: 0 });

    expect(jobs.update).not.toHaveBeenCalled();
  });
});
