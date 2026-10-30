import { randomUUID } from 'node:crypto';

import { type EmailJob, FINISHED_JOB_STATUSES, type Job, JOB_LIMITS } from '@job-queue/contracts';
import { type Clock, JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { BulkLimitExceededError } from '../../domain/jobs/errors/bulk-limit-exceeded.error.js';
import { InvalidJobFieldError } from '../../domain/jobs/errors/invalid-job-field.error.js';
import { InvalidJobPayloadError } from '../../domain/jobs/errors/invalid-job-payload.error.js';
import { InvalidJobResultError } from '../../domain/jobs/errors/invalid-job-result.error.js';
import { JobQueueUnavailableError } from '../../domain/jobs/errors/job-queue-unavailable.error.js';
import { type PageLimit, QueryLimitExceededError } from '@job-queue/kernel';
import type { JobQueue } from '../../domain/jobs/job-queue.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';
import { JobServiceImpl } from './job-service.impl.js';

const JOB_ID = randomUUID();
const NOW = '2026-10-29T12:00:00.000Z';
const PARAMS = { bulkMaxJobs: 3 };
const PAGE_SIZE = 20;
/** The furthest a job may be scheduled ahead of `NOW`, in milliseconds. */
const MAX_AHEAD_MS = JOB_LIMITS.scheduledAt.maxAheadDays * 24 * 60 * 60 * 1000;

describe('JobServiceImpl', () => {
  let repository: DeepMockProxy<JobRepository>;
  let queue: DeepMockProxy<JobQueue>;
  let clock: DeepMockProxy<Clock>;
  let logger: DeepMockProxy<Pick<LoggerService, 'log' | 'warn' | 'error'>>;
  let pageLimit: DeepMockProxy<PageLimit>;
  let service: JobServiceImpl;

  const storedJob = (overrides: Partial<EmailJob> = {}): EmailJob => ({
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

  /** `NOW` plus the given milliseconds, as an execution time. */
  const atNowPlus = (ms: number): string => new Date(Date.parse(NOW) + ms).toISOString();

  beforeEach(() => {
    repository = mockDeep<JobRepository>();
    queue = mockDeep<JobQueue>();
    clock = mockDeep<Clock>();
    logger = mockDeep<Pick<LoggerService, 'log' | 'warn' | 'error'>>();
    pageLimit = mockDeep<PageLimit>();
    clock.now.mockReturnValueOnce({ now: new Date(NOW) });
    repository.create.mockImplementationOnce((req) =>
      Promise.resolve({
        job: {
          ...req.job,
          id: JOB_ID,
          groupId: req.job.groupId ?? null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    service = new JobServiceImpl({ repository, queue, clock, logger, pageLimit }, PARAMS);
  });

  const error = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };

  /** The repository accepts the next write and returns the job with the changes applied. */
  const acceptsWrite = (): void => {
    repository.update.mockImplementationOnce((req) =>
      Promise.resolve({ job: { ...storedJob(), ...req.changes } as Job }),
    );
  };

  describe('create', () => {
    const request = {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
      priority: 7,
      maxAttempts: 4,
    } as const;

    it('Valid email job is accepted', async () => {
      queue.enqueue.mockResolvedValueOnce({});
      const { job } = await service.create({ job: request });

      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...expected
      } = storedJob({ priority: 7, maxAttempts: 4 });
      expect(repository.create).toHaveBeenCalledExactlyOnceWith({ job: expected });
      expect(job).toEqual({ ...expected, id: JOB_ID, createdAt: NOW, updatedAt: NOW });
    });

    it('Submitted job is queued', async () => {
      queue.enqueue.mockResolvedValueOnce({});
      await service.create({ job: request });

      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 1,
        attempt: 1,
        priority: 7,
        runAt: null,
      });
    });

    it('Queue unavailable during submit', async () => {
      queue.enqueue.mockRejectedValueOnce(
        new JobQueueUnavailableError({ jobId: JOB_ID, run: 1, attempt: 1 }),
      );

      const { job } = await service.create({ job: request });

      expect(job.status).toBe('pending');
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Job with a future execution time is scheduled', async () => {
      const scheduledAt = atNowPlus(60_000);
      queue.enqueue.mockResolvedValueOnce({});

      const { job } = await service.create({ job: { ...request, scheduledAt } });

      expect(repository.create).toHaveBeenCalledExactlyOnceWith({
        job: expect.objectContaining({ status: 'scheduled', attempts: 0, scheduledAt }) as unknown,
      });
      expect(job).toMatchObject({ status: 'scheduled', attempts: 0, scheduledAt });
    });

    it('Scheduled job is queued for its time', async () => {
      const scheduledAt = atNowPlus(60_000);
      queue.enqueue.mockResolvedValueOnce({});

      await service.create({ job: { ...request, scheduledAt } });

      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 1,
        attempt: 1,
        priority: 7,
        runAt: scheduledAt,
      });
    });

    it.each([
      ['a minute before', atNowPlus(-60_000)],
      ['exactly at', NOW],
      // One minute before `NOW` as an instant, though its wall-clock text sorts after `NOW`.
      ['a minute before, written with an offset,', '2026-10-29T13:59:00.000+02:00'],
    ])('Job with a past execution time runs at once (%s now)', async (_when, scheduledAt) => {
      queue.enqueue.mockResolvedValueOnce({});

      const { job } = await service.create({ job: { ...request, scheduledAt } });

      expect(job).toMatchObject({ status: 'pending', scheduledAt });
      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 1,
        attempt: 1,
        priority: 7,
        runAt: scheduledAt,
      });
    });

    it('Job without an execution time', async () => {
      queue.enqueue.mockResolvedValueOnce({});

      const { job } = await service.create({ job: request });

      expect(job).toMatchObject({ status: 'pending', scheduledAt: null });
    });

    it('Execution time too far ahead', async () => {
      const rejection = service.create({
        job: { ...request, scheduledAt: atNowPlus(MAX_AHEAD_MS + 1) },
      });

      await expect(rejection).rejects.toBeInstanceOf(InvalidJobFieldError);
      await expect(rejection).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: {
          issues: [
            expect.objectContaining({
              path: ['scheduledAt'],
              message: expect.stringContaining(
                `${String(JOB_LIMITS.scheduledAt.maxAheadDays)} days`,
              ) as unknown,
            }),
          ],
        },
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      ['in UTC', atNowPlus(MAX_AHEAD_MS)],
      ['written with an offset', '2026-11-28T14:00:00.000+02:00'],
    ])('Execution time at the maximum (%s)', async (_written, scheduledAt) => {
      queue.enqueue.mockResolvedValueOnce({});

      const { job } = await service.create({ job: { ...request, scheduledAt } });

      expect(job.status).toBe('scheduled');
      expect(repository.create).toHaveBeenCalledOnce();
    });

    it('Execution time too far ahead on a transit whose departure day is over', async () => {
      const rejection = service.create({
        job: {
          type: 'flight-transit',
          payload: { origin: 'LHR', destination: 'JFK', departureDate: '2026-10-28' },
          priority: 5,
          maxAttempts: 3,
          scheduledAt: atNowPlus(MAX_AHEAD_MS + 1),
        },
      });

      await expect(rejection).rejects.toBeInstanceOf(InvalidJobFieldError);
      await expect(rejection).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: {
          issues: [
            expect.objectContaining({ path: ['payload', 'departureDate'] }),
            expect.objectContaining({ path: ['scheduledAt'] }),
          ],
        },
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('Queue unavailable during a scheduled submit', async () => {
      queue.enqueue.mockRejectedValueOnce(
        new JobQueueUnavailableError({ jobId: JOB_ID, run: 1, attempt: 1 }),
      );

      const { job } = await service.create({ job: { ...request, scheduledAt: atNowPlus(60_000) } });

      expect(job.status).toBe('scheduled');
      expect(repository.create).toHaveBeenCalledExactlyOnceWith({
        job: expect.objectContaining({ status: 'scheduled' }) as unknown,
      });
      expect(repository.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ jobId: JOB_ID, attempt: 1 }),
        expect.any(String),
      );
    });

    it('Single job with a group id', async () => {
      const groupId = randomUUID();
      queue.enqueue.mockResolvedValueOnce({});

      const { job } = await service.create({ job: { ...request, groupId } });

      expect(repository.create).toHaveBeenCalledExactlyOnceWith({
        job: expect.objectContaining({ groupId }) as unknown,
      });
      expect(job.groupId).toBe(groupId);
    });

    it('Job without a group id', async () => {
      queue.enqueue.mockResolvedValueOnce({});

      const { job } = await service.create({ job: request });

      expect(repository.create).toHaveBeenCalledExactlyOnceWith({
        job: expect.objectContaining({ groupId: null }) as unknown,
      });
      expect(job.groupId).toBeNull();
    });
  });

  describe('createMany', () => {
    const email = {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
      priority: 7,
      maxAttempts: 4,
    } as const;
    const webhook = {
      type: 'webhook',
      payload: { method: 'GET', url: 'http://example.com/ping' },
      priority: 5,
      maxAttempts: 3,
    } as const;
    const transit = (departureDate: string) =>
      ({
        type: 'flight-transit',
        payload: { origin: 'LHR', destination: 'JFK', departureDate },
        priority: 5,
        maxAttempts: 3,
      }) as const;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    /** `NOW` plus the given milliseconds, as the bulk's creation times are spaced. */
    const nowPlus = (ms: number): string => new Date(Date.parse(NOW) + ms).toISOString();

    beforeEach(() => {
      repository.createMany.mockImplementationOnce((req) =>
        Promise.resolve({
          jobs: req.jobs.map((job, index) => ({
            ...job,
            id: ids[index]!,
            groupId: job.groupId ?? null,
            createdAt: job.createdAt ?? NOW,
            updatedAt: NOW,
          })),
        }),
      );
    });

    it('Mixed job types are created in request order', async () => {
      queue.enqueueMany.mockResolvedValueOnce({});

      const { jobs } = await service.createMany({
        jobs: [email, webhook, transit('2026-10-30')],
      });

      const pending = {
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        groupId: null,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
      };
      expect(repository.createMany).toHaveBeenCalledExactlyOnceWith({
        jobs: [
          { ...email, ...pending, createdAt: nowPlus(0) },
          { ...webhook, ...pending, createdAt: nowPlus(1) },
          { ...transit('2026-10-30'), ...pending, createdAt: nowPlus(2) },
        ],
      });
      expect(jobs.map((job) => [job.id, job.type])).toEqual([
        [ids[0], 'email'],
        [ids[1], 'webhook'],
        [ids[2], 'flight-transit'],
      ]);
    });

    it('Bulk items with a group id', async () => {
      const groupId = randomUUID();
      queue.enqueueMany.mockResolvedValueOnce({});

      const { jobs } = await service.createMany({
        jobs: [
          { ...email, groupId },
          { ...webhook, groupId },
        ],
      });

      expect(jobs.map((job) => job.groupId)).toEqual([groupId, groupId]);
    });

    it('Every bulk job is queued', async () => {
      queue.enqueueMany.mockResolvedValueOnce({});

      await service.createMany({ jobs: [email, webhook] });

      expect(queue.enqueueMany).toHaveBeenCalledExactlyOnceWith({
        entries: [
          { jobId: ids[0], run: 1, attempt: 1, priority: 7, runAt: null },
          { jobId: ids[1], run: 1, attempt: 1, priority: 5, runAt: null },
        ],
      });
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('Queue unavailable during bulk submit', async () => {
      const entries = [
        { jobId: ids[0]!, run: 1, attempt: 1 },
        { jobId: ids[1]!, run: 1, attempt: 1 },
      ];
      queue.enqueueMany.mockRejectedValueOnce(new JobQueueUnavailableError({ entries }));

      const { jobs } = await service.createMany({ jobs: [email, webhook] });

      expect(jobs.map((job) => [job.id, job.status])).toEqual([
        [ids[0], 'pending'],
        [ids[1], 'pending'],
      ]);
      expect(logger.log.mock.calls).toEqual([
        [{ jobId: ids[0] }, 'Job submitted'],
        [{ jobId: ids[1] }, 'Job submitted'],
      ]);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ jobId: ids[0], attempt: 1 }),
        'Job keeps its status: it could not be queued',
      );
      expect(logger.warn).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ jobId: ids[1], attempt: 1 }),
        'Job keeps its status: it could not be queued',
      );
    });

    it('stores nothing and queues nothing when storing the bulk fails', async () => {
      const failure = new Error('database down');
      repository.createMany.mockReset();
      repository.createMany.mockRejectedValueOnce(failure);

      await expect(service.createMany({ jobs: [email, webhook] })).rejects.toBe(failure);
      expect(queue.enqueueMany).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('Largest allowed bulk', async () => {
      queue.enqueueMany.mockResolvedValueOnce({});

      const { jobs } = await service.createMany({ jobs: [email, email, email] });

      expect(jobs).toHaveLength(PARAMS.bulkMaxJobs);
    });

    it('Too many jobs', async () => {
      const rejection = service.createMany({ jobs: [email, email, email, email] });

      await expect(rejection).rejects.toBeInstanceOf(BulkLimitExceededError);
      await expect(rejection).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: {
          issues: [expect.objectContaining({ path: ['jobs'], maximum: PARAMS.bulkMaxJobs })],
        },
      });
      expect(repository.createMany).not.toHaveBeenCalled();
      expect(queue.enqueueMany).not.toHaveBeenCalled();
    });

    it('One item breaking a job-service rule', async () => {
      const ruleRejection = service.createMany({
        jobs: [email, transit('2026-10-28'), transit('2026-10-27')],
      });

      await expect(ruleRejection).rejects.toBeInstanceOf(InvalidJobFieldError);
      await expect(ruleRejection).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: {
          issues: [
            expect.objectContaining({ path: ['jobs', 1, 'payload', 'departureDate'] }),
            expect.objectContaining({ path: ['jobs', 2, 'payload', 'departureDate'] }),
          ],
        },
      });
      expect(repository.createMany).not.toHaveBeenCalled();
      expect(queue.enqueueMany).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('Bulk items with and without an execution time', async () => {
      const scheduledAt = atNowPlus(60_000);
      queue.enqueueMany.mockResolvedValueOnce({});

      const { jobs } = await service.createMany({ jobs: [{ ...email, scheduledAt }, webhook] });

      expect(jobs.map((job) => [job.status, job.scheduledAt])).toEqual([
        ['scheduled', scheduledAt],
        ['pending', null],
      ]);
      expect(queue.enqueueMany).toHaveBeenCalledExactlyOnceWith({
        entries: [
          { jobId: ids[0], run: 1, attempt: 1, priority: 7, runAt: scheduledAt },
          { jobId: ids[1], run: 1, attempt: 1, priority: 5, runAt: null },
        ],
      });
    });

    it('Bulk item with an execution time too far ahead', async () => {
      const rejection = service.createMany({
        jobs: [
          { ...email, scheduledAt: atNowPlus(MAX_AHEAD_MS) },
          { ...webhook, scheduledAt: atNowPlus(MAX_AHEAD_MS + 1) },
          transit('2026-10-28'),
        ],
      });

      await expect(rejection).rejects.toBeInstanceOf(InvalidJobFieldError);
      await expect(rejection).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: {
          issues: [
            expect.objectContaining({ path: ['jobs', 1, 'scheduledAt'] }),
            expect.objectContaining({ path: ['jobs', 2, 'payload', 'departureDate'] }),
          ],
        },
      });
      expect(repository.createMany).not.toHaveBeenCalled();
      expect(queue.enqueueMany).not.toHaveBeenCalled();
    });

    it('accepts a flight transit departing today', async () => {
      queue.enqueueMany.mockResolvedValueOnce({});

      const { jobs } = await service.createMany({ jobs: [transit('2026-10-29')] });

      expect(jobs).toHaveLength(1);
    });
  });

  describe('create a flight transit job', () => {
    const transitRequest = (departureDate: string) =>
      ({
        type: 'flight-transit',
        payload: { origin: 'LHR', destination: 'JFK', departureDate },
        priority: 5,
        maxAttempts: 3,
      }) as const;
    const at = (iso: string): void => {
      clock.now.mockReset();
      clock.now.mockReturnValueOnce({ now: new Date(iso) });
    };

    it('Departure today is accepted', async () => {
      at('2026-10-29T23:59:59.999Z');
      queue.enqueue.mockResolvedValueOnce({});

      const { job } = await service.create({ job: transitRequest('2026-10-29') });

      expect(job).toMatchObject({ type: 'flight-transit', status: 'pending' });
      expect(repository.create).toHaveBeenCalledOnce();
      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 1,
        attempt: 1,
        priority: 5,
        runAt: null,
      });
    });

    it('accepts a departure on a later day', async () => {
      at('2026-10-29T00:00:00.000Z');
      queue.enqueue.mockResolvedValueOnce({});

      await service.create({ job: transitRequest('2027-01-01') });

      expect(repository.create).toHaveBeenCalledOnce();
    });

    it('Departure yesterday is rejected', async () => {
      at('2026-10-30T00:00:00.000Z');

      const rejection = service.create({ job: transitRequest('2026-10-29') });

      await expect(rejection).rejects.toBeInstanceOf(InvalidJobPayloadError);
      await expect(rejection).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { issues: [expect.objectContaining({ path: ['payload', 'departureDate'] })] },
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns the stored job', async () => {
      repository.get.mockResolvedValueOnce({ job: storedJob(), run: 1 });

      await expect(service.get({ id: JOB_ID })).resolves.toEqual({ job: storedJob() });
    });
  });

  describe('query', () => {
    beforeEach(() => {
      repository.query.mockResolvedValueOnce({ items: [storedJob()], total: 1 });
    });

    it('passes the requested page through', async () => {
      pageLimit.resolve.mockReturnValueOnce({ limit: 2 });

      await expect(service.query({ limit: 2, offset: 1 })).resolves.toEqual({
        items: [storedJob()],
        total: 1,
      });
      expect(pageLimit.resolve).toHaveBeenCalledExactlyOnceWith({ limit: 2 });
      expect(repository.query).toHaveBeenCalledExactlyOnceWith({ limit: 2, offset: 1 });
    });

    it('passes the status and type filters through with the resolved page', async () => {
      pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });

      await service.query({ offset: 3, statuses: ['failed', 'cancelled'], types: ['webhook'] });

      expect(repository.query).toHaveBeenCalledExactlyOnceWith({
        limit: PAGE_SIZE,
        offset: 3,
        statuses: ['failed', 'cancelled'],
        types: ['webhook'],
      });
    });

    it('Group filter combines with status and type', async () => {
      const groupId = randomUUID();
      pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });

      await service.query({ offset: 0, statuses: ['failed'], types: ['email'], groupId });

      expect(repository.query).toHaveBeenCalledExactlyOnceWith({
        limit: PAGE_SIZE,
        offset: 0,
        statuses: ['failed'],
        types: ['email'],
        groupId,
      });
    });

    it('Default page size: asks the page limit for the size when no limit is given', async () => {
      pageLimit.resolve.mockReturnValueOnce({ limit: PAGE_SIZE });

      await service.query({ offset: 0 });

      expect(pageLimit.resolve).toHaveBeenCalledExactlyOnceWith({ limit: undefined });
      expect(repository.query).toHaveBeenCalledExactlyOnceWith({ limit: PAGE_SIZE, offset: 0 });
    });

    it('Limit above maximum: the page-limit error is passed on and nothing is queried', async () => {
      const failure = new QueryLimitExceededError({ maxLimit: 100 });
      pageLimit.resolve.mockImplementationOnce(() => {
        throw failure;
      });

      await expect(service.query({ limit: 101, offset: 0 })).rejects.toBe(failure);
      expect(repository.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('Start a pending job', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'pending', attempts: 0 }),
        run: 1,
      });

      const { job } = await service.update({ id: JOB_ID, update: { status: 'processing' } });

      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'pending', attempts: 0 },
        changes: { status: 'processing', attempts: 1, startedAt: NOW },
      });
      expect(job.status).toBe('processing');
    });

    it('Start a scheduled job', async () => {
      const scheduledAt = '2026-10-29T11:30:00.000Z';
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'scheduled', attempts: 0, scheduledAt }),
        run: 1,
      });

      const { job } = await service.update({ id: JOB_ID, update: { status: 'processing' } });

      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'scheduled', attempts: 0 },
        changes: { status: 'processing', attempts: 1, startedAt: NOW },
      });
      expect(job.status).toBe('processing');
    });

    it('Start a job that is not pending', async () => {
      for (const status of ['processing', 'completed', 'failed', 'cancelled'] as const) {
        repository.get.mockResolvedValueOnce({ job: storedJob({ status, attempts: 1 }), run: 1 });

        const update = service.update({ id: JOB_ID, update: { status: 'processing' } });

        await expect(update).rejects.toBeInstanceOf(JobStatusConflictError);
        await expect(update).rejects.toMatchObject({ details: { status } });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Two workers start the same job', async () => {
      repository.get.mockResolvedValueOnce({ job: storedJob(), run: 1 });
      repository.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'processing' }),
      );

      await expect(
        service.update({ id: JOB_ID, update: { status: 'processing' } }),
      ).rejects.toBeInstanceOf(JobStatusConflictError);
      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'pending', attempts: 0 },
        changes: { status: 'processing', attempts: 1, startedAt: NOW },
      });
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('Complete a processing job', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1 }),
        run: 1,
      });

      await service.update({
        id: JOB_ID,
        update: { status: 'completed', result: { messageId: 'm-1' } },
      });

      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'processing', attempts: 1 },
        changes: {
          status: 'completed',
          result: { messageId: 'm-1' },
          error: null,
          completedAt: NOW,
        },
      });
    });

    it('Result does not match the job type', async () => {
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1 }),
        run: 1,
      });

      const update = service.update({
        id: JOB_ID,
        update: { status: 'completed', result: { id: 'm-1' } },
      });

      await expect(update).rejects.toBeInstanceOf(InvalidJobResultError);
      await expect(update).rejects.toMatchObject({
        details: { issues: [expect.objectContaining({ path: ['result', 'messageId'] })] },
      });
      expect(repository.update).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('Complete a job that is not processing', async () => {
      for (const status of ['scheduled', 'pending', 'completed', 'failed', 'cancelled'] as const) {
        repository.get.mockResolvedValueOnce({ job: storedJob({ status, attempts: 1 }), run: 1 });

        await expect(
          service.update({
            id: JOB_ID,
            update: { status: 'completed', result: { messageId: 'm' } },
          }),
        ).rejects.toMatchObject({ code: 'JOB_STATUS_CONFLICT', details: { status } });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Failure with attempts left', async () => {
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 }),
        run: 1,
      });

      const { job } = await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'processing', attempts: 1 },
        changes: { status: 'pending', error, completedAt: null },
      });
      expect(job.status).toBe('pending');
      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 1,
        attempt: 2,
        priority: 5,
        runAt: null,
      });
    });

    it("queues the next attempt of a failure in the job's current run", async () => {
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 }),
        run: 4,
      });

      await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 4,
        attempt: 2,
        priority: 5,
        runAt: null,
      });
    });

    it('Retried high-priority job overtakes waiting low-priority jobs', async () => {
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      repository.get.mockResolvedValueOnce({
        job: storedJob({
          status: 'processing',
          attempts: 1,
          maxAttempts: 3,
          priority: JOB_LIMITS.priority.max,
          scheduledAt: '2026-10-29T11:30:00.000Z',
        }),
        run: 1,
      });

      await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 1,
        attempt: 2,
        priority: JOB_LIMITS.priority.max,
        runAt: null,
      });
    });

    it('Retry survives an unavailable queue', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 }),
        run: 1,
      });
      queue.enqueue.mockRejectedValueOnce(
        new JobQueueUnavailableError({ jobId: JOB_ID, run: 1, attempt: 2 }),
      );

      const { job } = await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(job.status).toBe('pending');
      expect(logger.warn.mock.calls).toEqual([
        [
          { jobId: JOB_ID, attempt: 1, code: error.code, message: error.message },
          'Attempt failed, retry scheduled',
        ],
        [
          expect.objectContaining({ jobId: JOB_ID, attempt: 2 }),
          'Job keeps its status: it could not be queued',
        ],
      ]);
      expect(logger.log).not.toHaveBeenCalledWith(expect.anything(), 'Attempt queued');
    });

    it('Failure on the last attempt', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 3, maxAttempts: 3 }),
        run: 1,
      });

      const { job } = await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'processing', attempts: 3 },
        changes: { status: 'failed', error, completedAt: NOW },
      });
      expect(job.status).toBe('failed');
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('Fail a job that is not processing', async () => {
      for (const status of ['scheduled', 'pending', 'completed', 'failed', 'cancelled'] as const) {
        repository.get.mockResolvedValueOnce({ job: storedJob({ status, attempts: 1 }), run: 1 });

        await expect(
          service.update({ id: JOB_ID, update: { status: 'failed', error } }),
        ).rejects.toMatchObject({ code: 'JOB_STATUS_CONFLICT', details: { status } });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    const error = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };

    /** The repository accepts the next write and returns the job with the changes applied. */
    const acceptsWrite = (base: Job): void => {
      repository.update.mockImplementationOnce((req) => {
        const { run: _run, ...changes } = req.changes;
        return Promise.resolve({ job: { ...base, ...changes } as Job });
      });
    };

    describe('cancel', () => {
      const cancel = { id: JOB_ID, change: { status: 'cancelled' } } as const;

      it.each([
        ['Cancel a pending job', 'pending', 0],
        ['Cancel a scheduled job', 'scheduled', 0],
        ['Cancel a processing job', 'processing', 1],
      ] as const)('%s', async (_name, status, attempts) => {
        const current = storedJob({ status, attempts });
        repository.get.mockResolvedValueOnce({ job: current, run: 1 });
        acceptsWrite(current);
        queue.cancel.mockResolvedValueOnce({});

        const { job } = await service.changeStatus(cancel);

        expect(repository.update).toHaveBeenCalledExactlyOnceWith({
          id: JOB_ID,
          expected: { status, attempts },
          changes: { status: 'cancelled', completedAt: NOW },
        });
        expect(job).toMatchObject({ status: 'cancelled', attempts, completedAt: NOW });
        expect(queue.cancel).toHaveBeenCalledExactlyOnceWith({ jobId: JOB_ID });
        expect(queue.enqueue).not.toHaveBeenCalled();
      });

      it('keeps the error and result of a cancelled job', async () => {
        const current = storedJob({ status: 'pending', attempts: 1, error });
        repository.get.mockResolvedValueOnce({ job: current, run: 1 });
        acceptsWrite(current);
        queue.cancel.mockResolvedValueOnce({});

        await service.changeStatus(cancel);

        const changes = repository.update.mock.calls[0]?.[0].changes;
        expect(changes).not.toHaveProperty('error');
        expect(changes).not.toHaveProperty('result');
        expect(changes).not.toHaveProperty('attempts');
      });

      it('returns the cancelled job and logs a warning when the cancellation cannot be announced', async () => {
        const current = storedJob({ status: 'processing', attempts: 1 });
        repository.get.mockResolvedValueOnce({ job: current, run: 1 });
        acceptsWrite(current);
        queue.cancel.mockRejectedValueOnce(
          new JobQueueUnavailableError({ cancelledJobId: JOB_ID }),
        );

        const { job } = await service.changeStatus(cancel);

        expect(job.status).toBe('cancelled');
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ jobId: JOB_ID }),
          expect.any(String),
        );
      });

      it('Cancel a finished job', async () => {
        for (const status of FINISHED_JOB_STATUSES) {
          repository.get.mockResolvedValueOnce({ job: storedJob({ status, attempts: 1 }), run: 1 });

          const change = service.changeStatus(cancel);

          await expect(change).rejects.toBeInstanceOf(JobStatusConflictError);
          await expect(change).rejects.toMatchObject({ details: { status } });
        }
        expect(repository.update).not.toHaveBeenCalled();
        expect(queue.cancel).not.toHaveBeenCalled();
      });

      it('Two cancels at the same time: the losing write is a conflict and announces nothing', async () => {
        repository.get.mockResolvedValueOnce({ job: storedJob(), run: 1 });
        repository.update.mockRejectedValueOnce(
          new JobStatusConflictError({ id: JOB_ID, status: 'cancelled' }),
        );

        await expect(service.changeStatus(cancel)).rejects.toBeInstanceOf(JobStatusConflictError);
        expect(queue.cancel).not.toHaveBeenCalled();
      });
    });

    describe('retry', () => {
      const retry = { id: JOB_ID, change: { status: 'pending' } } as const;
      const failed = (): EmailJob =>
        storedJob({
          status: 'failed',
          attempts: 3,
          maxAttempts: 3,
          error,
          startedAt: '2026-10-29T11:30:00.000Z',
          completedAt: '2026-10-29T11:31:00.000Z',
        });

      it('Retry a failed job', async () => {
        repository.get.mockResolvedValueOnce({ job: failed(), run: 2 });
        acceptsWrite(failed());
        queue.enqueue.mockResolvedValueOnce({});

        const { job } = await service.changeStatus(retry);

        expect(repository.update).toHaveBeenCalledExactlyOnceWith({
          id: JOB_ID,
          expected: { status: 'failed', attempts: 3 },
          changes: {
            status: 'pending',
            attempts: 0,
            result: null,
            error: null,
            startedAt: null,
            completedAt: null,
            run: 3,
          },
        });
        expect(job).toEqual({
          ...failed(),
          status: 'pending',
          attempts: 0,
          error: null,
          startedAt: null,
          completedAt: null,
        });
        expect(queue.cancel).not.toHaveBeenCalled();
      });

      it('Retried job is queued', async () => {
        repository.get.mockResolvedValueOnce({ job: failed(), run: 2 });
        acceptsWrite(failed());
        queue.enqueue.mockResolvedValueOnce({});

        await service.changeStatus(retry);

        expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
          jobId: JOB_ID,
          run: 3,
          attempt: 1,
          priority: 5,
          runAt: null,
        });
      });

      it('Manual retry survives an unavailable queue', async () => {
        repository.get.mockResolvedValueOnce({ job: failed(), run: 1 });
        acceptsWrite(failed());
        queue.enqueue.mockRejectedValueOnce(
          new JobQueueUnavailableError({ jobId: JOB_ID, run: 2, attempt: 1 }),
        );

        const { job } = await service.changeStatus(retry);

        expect(job.status).toBe('pending');
        expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ jobId: JOB_ID, run: 2, attempt: 1 }),
          expect.any(String),
        );
      });

      it('Retry a job that has not failed', async () => {
        for (const status of [
          'scheduled',
          'pending',
          'processing',
          'completed',
          'cancelled',
        ] as const) {
          repository.get.mockResolvedValueOnce({ job: storedJob({ status, attempts: 1 }), run: 1 });

          const change = service.changeStatus(retry);

          await expect(change).rejects.toBeInstanceOf(JobStatusConflictError);
          await expect(change).rejects.toMatchObject({ details: { status } });
        }
        expect(repository.update).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
      });

      it('Two retries at the same time: the losing write is a conflict and queues nothing', async () => {
        repository.get.mockResolvedValueOnce({ job: failed(), run: 1 });
        repository.update.mockRejectedValueOnce(
          new JobStatusConflictError({ id: JOB_ID, status: 'pending' }),
        );

        await expect(service.changeStatus(retry)).rejects.toBeInstanceOf(JobStatusConflictError);
        expect(queue.enqueue).not.toHaveBeenCalled();
      });
    });

    it('Status change for an unknown job', async () => {
      repository.get.mockRejectedValueOnce(new JobNotFoundError({ id: JOB_ID }));

      await expect(
        service.changeStatus({ id: JOB_ID, change: { status: 'cancelled' } }),
      ).rejects.toBeInstanceOf(JobNotFoundError);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('Delete a finished job', async () => {
      repository.delete.mockResolvedValueOnce({});

      await expect(service.delete({ id: JOB_ID })).resolves.toEqual({});
      expect(repository.delete).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        allowedStatuses: FINISHED_JOB_STATUSES,
      });
    });
  });
  describe('job log lines', () => {
    const request = {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
      priority: 7,
      maxAttempts: 4,
    } as const;

    it('Submitted and queued job is logged', async () => {
      queue.enqueue.mockResolvedValueOnce({});

      await service.create({ job: request });

      expect(logger.log).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenNthCalledWith(1, { jobId: JOB_ID }, 'Job submitted');
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        { jobId: JOB_ID, attempt: 1 },
        'Attempt queued',
      );
    });

    it('Submitted and queued job is logged for each item of a bulk', async () => {
      const ids = [randomUUID(), randomUUID()];
      repository.createMany.mockImplementationOnce((req) =>
        Promise.resolve({
          jobs: req.jobs.map((job, index) => ({
            ...job,
            id: ids[index]!,
            groupId: null,
            createdAt: NOW,
            updatedAt: NOW,
          })),
        }),
      );
      queue.enqueueMany.mockResolvedValueOnce({});

      await service.createMany({ jobs: [request, request] });

      expect(logger.log.mock.calls).toEqual([
        [{ jobId: ids[0] }, 'Job submitted'],
        [{ jobId: ids[1] }, 'Job submitted'],
        [{ jobId: ids[0], attempt: 1 }, 'Attempt queued'],
        [{ jobId: ids[1], attempt: 1 }, 'Attempt queued'],
      ]);
    });

    it('Queueing failure is logged', async () => {
      queue.enqueue.mockRejectedValueOnce(
        new JobQueueUnavailableError({ jobId: JOB_ID, run: 1, attempt: 1 }),
      );

      await service.create({ job: request });

      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ jobId: JOB_ID, attempt: 1 }),
        'Job keeps its status: it could not be queued',
      );
      expect(logger.log).not.toHaveBeenCalledWith(expect.anything(), 'Attempt queued');
    });

    it('Started and completed job is logged', async () => {
      clock.now.mockReturnValueOnce({ now: new Date(NOW) });
      acceptsWrite();
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'pending', attempts: 1 }),
        run: 1,
      });
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 2 }),
        run: 1,
      });

      await service.update({ id: JOB_ID, update: { status: 'processing' } });
      await service.update({
        id: JOB_ID,
        update: { status: 'completed', result: { messageId: 'm-1' } },
      });

      expect(logger.log.mock.calls).toEqual([
        [{ jobId: JOB_ID, attempt: 2 }, 'Attempt started'],
        [{ jobId: JOB_ID, attempt: 2 }, 'Job completed'],
      ]);
    });

    it('Failed attempt with a retry is logged', async () => {
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 }),
        run: 1,
      });

      await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        { jobId: JOB_ID, attempt: 1, code: error.code, message: error.message },
        'Attempt failed, retry scheduled',
      );
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledExactlyOnceWith(
        { jobId: JOB_ID, attempt: 2 },
        'Attempt queued',
      );
    });

    it('Job failed for good is logged', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 3, maxAttempts: 3 }),
        run: 1,
      });

      await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        { jobId: JOB_ID, attempt: 3, code: error.code, message: error.message },
        'Job failed for good',
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalledWith(expect.anything(), 'Attempt queued');
    });

    it('logs nothing when the report is refused', async () => {
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'completed', attempts: 1 }),
        run: 1,
      });
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'pending', attempts: 0 }),
        run: 1,
      });

      await expect(
        service.update({ id: JOB_ID, update: { status: 'processing' } }),
      ).rejects.toMatchObject({ code: 'JOB_STATUS_CONFLICT' });
      await expect(
        service.update({ id: JOB_ID, update: { status: 'failed', error } }),
      ).rejects.toMatchObject({ code: 'JOB_STATUS_CONFLICT' });

      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs nothing when another worker won the race', async () => {
      repository.get.mockResolvedValueOnce({ job: storedJob(), run: 1 });
      repository.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'processing' }),
      );

      await expect(
        service.update({ id: JOB_ID, update: { status: 'processing' } }),
      ).rejects.toBeInstanceOf(JobStatusConflictError);

      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });
});
