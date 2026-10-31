import { randomUUID } from 'node:crypto';

import { type EmailJob, FINISHED_JOB_STATUSES, type Job, JOB_LIMITS } from '@job-queue/contracts';
import { type Clock, JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { BulkLimitExceededError } from '../../domain/jobs/errors/bulk-limit-exceeded.error.js';
import { IdempotencyKeyConflictError } from '../../domain/jobs/errors/idempotency-key-conflict.error.js';
import { IdempotencyKeyTakenError } from '../../domain/jobs/errors/idempotency-key-taken.error.js';
import { InvalidJobFieldError } from '../../domain/jobs/errors/invalid-job-field.error.js';
import { InvalidJobPayloadError } from '../../domain/jobs/errors/invalid-job-payload.error.js';
import { InvalidJobResultError } from '../../domain/jobs/errors/invalid-job-result.error.js';
import { JobQueueUnavailableError } from '../../domain/jobs/errors/job-queue-unavailable.error.js';
import { type PageLimit, QueryLimitExceededError } from '@job-queue/kernel';
import type { JobQueue } from '../../domain/jobs/job-queue.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';
import type { JobRequestFingerprint } from '../../domain/jobs/job-request-fingerprint.js';
import type { RetryDelay } from '../../domain/jobs/retry-delay.js';
import { BULK_INSERT_TRIES, JobServiceImpl } from './job-service.impl.js';

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
  let retryDelay: DeepMockProxy<RetryDelay>;
  let fingerprint: DeepMockProxy<JobRequestFingerprint>;
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
    idempotencyKey: null,
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
    retryDelay = mockDeep<RetryDelay>();
    fingerprint = mockDeep<JobRequestFingerprint>();
    clock.now.mockReturnValueOnce({ now: new Date(NOW) });
    repository.create.mockImplementationOnce(({ job: { requestFingerprint: _fp, ...job } }) =>
      Promise.resolve({
        job: {
          ...job,
          id: JOB_ID,
          groupId: job.groupId ?? null,
          idempotencyKey: job.idempotencyKey ?? null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    service = new JobServiceImpl(
      { repository, queue, clock, logger, pageLimit, retryDelay, fingerprint },
      PARAMS,
    );
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
      const { job, created } = await service.create({ job: request });

      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...expected
      } = storedJob({ priority: 7, maxAttempts: 4 });
      expect(repository.create).toHaveBeenCalledExactlyOnceWith({
        job: { ...expected, requestFingerprint: null },
      });
      expect(job).toEqual({ ...expected, id: JOB_ID, createdAt: NOW, updatedAt: NOW });
      expect(created).toBe(true);
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
          jobs: req.jobs.map(({ requestFingerprint: _fp, ...job }, index) => ({
            ...job,
            id: ids[index]!,
            groupId: job.groupId ?? null,
            idempotencyKey: job.idempotencyKey ?? null,
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
        idempotencyKey: null,
        requestFingerprint: null,
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
      repository.get.mockResolvedValueOnce({ job: storedJob(), run: 1, requestFingerprint: null });

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
    /** The stored job as `repository.get` answers it. */
    const inStore = (job: Job, run = 1) => ({ job, run, requestFingerprint: null });
    const start = (attempt: number, run = 1) => ({ status: 'processing', run, attempt }) as const;
    const complete = (attempt: number, run = 1) =>
      ({ status: 'completed', run, attempt, result: { messageId: 'm-1' } }) as const;
    const fail = (attempt: number, run = 1) => ({ status: 'failed', run, attempt, error }) as const;

    it('Start a pending job', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce(inStore(storedJob({ status: 'pending', attempts: 0 })));

      const { job } = await service.update({ id: JOB_ID, update: start(1) });

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
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'scheduled', attempts: 1, scheduledAt })),
      );

      const { job } = await service.update({ id: JOB_ID, update: start(2) });

      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'scheduled', attempts: 1 },
        changes: { status: 'processing', attempts: 2, startedAt: NOW },
      });
      expect(job.status).toBe('processing');
    });

    it('Start a job that is not pending', async () => {
      for (const status of ['completed', 'failed', 'cancelled'] as const) {
        repository.get.mockResolvedValueOnce(inStore(storedJob({ status, attempts: 1 })));

        const update = service.update({ id: JOB_ID, update: start(2) });

        await expect(update).rejects.toBeInstanceOf(JobStatusConflictError);
        await expect(update).rejects.toMatchObject({ details: { status } });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Start a job that is not pending: a processing job refuses a start for another attempt', async () => {
      for (const attempt of [1, 3]) {
        repository.get.mockResolvedValueOnce(
          inStore(storedJob({ status: 'processing', attempts: 2 })),
        );

        const update = service.update({ id: JOB_ID, update: start(attempt) });

        await expect(update).rejects.toBeInstanceOf(JobStatusConflictError);
        await expect(update).rejects.toMatchObject({ details: { status: 'processing' } });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Repeated start of the same attempt', async () => {
      const running = storedJob({ status: 'processing', attempts: 2 });
      repository.get.mockResolvedValueOnce(inStore(running, 3));

      const { job } = await service.update({ id: JOB_ID, update: start(2, 3) });

      expect(job).toEqual(running);
      expect(repository.update).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('Start for a stale attempt', async () => {
      const scheduledAt = '2026-10-29T11:30:00.000Z';
      // The scheduled job has made attempt 1, so only attempt 2 may start: 1 is behind, 3 is ahead.
      for (const attempt of [1, 3]) {
        repository.get.mockResolvedValueOnce(
          inStore(storedJob({ status: 'scheduled', attempts: 1, scheduledAt })),
        );

        await expect(service.update({ id: JOB_ID, update: start(attempt) })).rejects.toMatchObject({
          code: 'JOB_STATUS_CONFLICT',
          details: { status: 'scheduled' },
        });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Start from another run', async () => {
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'pending', attempts: 0 }), 2),
      );

      await expect(service.update({ id: JOB_ID, update: start(1, 1) })).rejects.toMatchObject({
        code: 'JOB_STATUS_CONFLICT',
        details: { status: 'pending' },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Two workers start the same job', async () => {
      repository.get.mockResolvedValueOnce(inStore(storedJob({ status: 'pending', attempts: 0 })));
      repository.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'processing' }),
      );
      const winner = storedJob({ status: 'processing', attempts: 1 });
      repository.get.mockResolvedValueOnce(inStore(winner));

      const { job } = await service.update({ id: JOB_ID, update: start(1) });

      expect(job).toEqual(winner);
      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'pending', attempts: 0 },
        changes: { status: 'processing', attempts: 1, startedAt: NOW },
      });
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it.each([
      ['cancelled', 1, 1],
      ['processing', 1, 3],
      ['processing', 2, 2],
    ] as const)(
      'a lost start is a conflict when the job is now %s in run %s with %s attempts',
      async (status, run, attempts) => {
        repository.get.mockResolvedValueOnce(
          inStore(storedJob({ status: 'pending', attempts: 1 })),
        );
        const conflict = new JobStatusConflictError({ id: JOB_ID, status });
        repository.update.mockRejectedValueOnce(conflict);
        repository.get.mockResolvedValueOnce(inStore(storedJob({ status, attempts }), run));

        await expect(service.update({ id: JOB_ID, update: start(2) })).rejects.toBe(conflict);
      },
    );

    it('Complete a processing job', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 1 })),
      );

      await service.update({ id: JOB_ID, update: complete(1) });

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
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 1 })),
      );

      const update = service.update({
        id: JOB_ID,
        update: { status: 'completed', run: 1, attempt: 1, result: { id: 'm-1' } },
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
        repository.get.mockResolvedValueOnce(inStore(storedJob({ status, attempts: 1 })));

        await expect(service.update({ id: JOB_ID, update: complete(1) })).rejects.toMatchObject({
          code: 'JOB_STATUS_CONFLICT',
          details: { status },
        });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Completion of a recovered attempt', async () => {
      // Recovery failed attempt 1 (the job is waiting for attempt 2) or attempt 2 already runs.
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'scheduled', attempts: 1 })),
      );
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 2 })),
      );

      await expect(service.update({ id: JOB_ID, update: complete(1) })).rejects.toMatchObject({
        code: 'JOB_STATUS_CONFLICT',
        details: { status: 'scheduled' },
      });
      await expect(service.update({ id: JOB_ID, update: complete(1) })).rejects.toMatchObject({
        code: 'JOB_STATUS_CONFLICT',
        details: { status: 'processing' },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Failure from an earlier run', async () => {
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 1 }), 2),
      );
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 1 }), 2),
      );

      await expect(service.update({ id: JOB_ID, update: fail(1, 1) })).rejects.toMatchObject({
        code: 'JOB_STATUS_CONFLICT',
        details: { status: 'processing' },
      });
      await expect(service.update({ id: JOB_ID, update: complete(1, 1) })).rejects.toMatchObject({
        code: 'JOB_STATUS_CONFLICT',
        details: { status: 'processing' },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Failure with attempts left', async () => {
      const delayMs = 7_000;
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      retryDelay.of.mockReturnValueOnce({ delayMs });
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 })),
      );

      const { job } = await service.update({ id: JOB_ID, update: fail(1) });

      const scheduledAt = atNowPlus(delayMs);
      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'processing', attempts: 1 },
        changes: { status: 'scheduled', error, scheduledAt, completedAt: null },
      });
      expect(job).toMatchObject({ status: 'scheduled', scheduledAt });
      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 1,
        attempt: 2,
        priority: 5,
        runAt: scheduledAt,
      });
    });

    it('Delay grows with each retry: the retry number is the number of attempts so far', async () => {
      for (const attempts of [1, 2, 3]) {
        acceptsWrite();
        queue.enqueue.mockResolvedValueOnce({});
        retryDelay.of.mockReturnValueOnce({ delayMs: 1_000 });
        repository.get.mockResolvedValueOnce(
          inStore(storedJob({ status: 'processing', attempts, maxAttempts: 4 })),
        );
        clock.now.mockReturnValueOnce({ now: new Date(NOW) });

        await service.update({ id: JOB_ID, update: fail(attempts) });
      }

      expect(retryDelay.of.mock.calls).toEqual([[{ retry: 1 }], [{ retry: 2 }], [{ retry: 3 }]]);
    });

    it("queues the next attempt of a failure in the job's current run", async () => {
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      retryDelay.of.mockReturnValueOnce({ delayMs: 5_000 });
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 }), 4),
      );

      await service.update({ id: JOB_ID, update: fail(1, 4) });

      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 4,
        attempt: 2,
        priority: 5,
        runAt: atNowPlus(5_000),
      });
    });

    it('Retried high-priority job keeps its priority for the next attempt', async () => {
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      retryDelay.of.mockReturnValueOnce({ delayMs: 5_000 });
      repository.get.mockResolvedValueOnce(
        inStore(
          storedJob({
            status: 'processing',
            attempts: 1,
            maxAttempts: 3,
            priority: JOB_LIMITS.priority.max,
            scheduledAt: '2026-10-29T11:30:00.000Z',
          }),
        ),
      );

      await service.update({ id: JOB_ID, update: fail(1) });

      expect(queue.enqueue).toHaveBeenCalledExactlyOnceWith({
        jobId: JOB_ID,
        run: 1,
        attempt: 2,
        priority: JOB_LIMITS.priority.max,
        runAt: atNowPlus(5_000),
      });
    });

    it('Retry survives an unavailable queue', async () => {
      acceptsWrite();
      retryDelay.of.mockReturnValueOnce({ delayMs: 5_000 });
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 })),
      );
      queue.enqueue.mockRejectedValueOnce(
        new JobQueueUnavailableError({ jobId: JOB_ID, run: 1, attempt: 2 }),
      );

      const { job } = await service.update({ id: JOB_ID, update: fail(1) });

      expect(job.status).toBe('scheduled');
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

    it('Invalid payload with attempts left', async () => {
      const invalidPayload = { code: 'INVALID_PAYLOAD', message: 'Payload does not match' };
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      retryDelay.of.mockReturnValueOnce({ delayMs: 5_000 });
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 })),
      );

      const { job } = await service.update({
        id: JOB_ID,
        update: { status: 'failed', run: 1, attempt: 1, error: invalidPayload },
      });

      expect(job).toMatchObject({ status: 'scheduled', error: invalidPayload });
      expect(queue.enqueue).toHaveBeenCalledOnce();
    });

    it('Failure on the last attempt', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce(
        inStore(storedJob({ status: 'processing', attempts: 3, maxAttempts: 3 })),
      );

      const { job } = await service.update({ id: JOB_ID, update: fail(3) });

      expect(repository.update).toHaveBeenCalledExactlyOnceWith({
        id: JOB_ID,
        expected: { status: 'processing', attempts: 3 },
        changes: { status: 'failed', error, completedAt: NOW },
      });
      expect(job.status).toBe('failed');
      expect(retryDelay.of).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('Fail a job that is not processing', async () => {
      for (const status of ['scheduled', 'pending', 'completed', 'failed', 'cancelled'] as const) {
        repository.get.mockResolvedValueOnce(inStore(storedJob({ status, attempts: 1 })));

        await expect(service.update({ id: JOB_ID, update: fail(1) })).rejects.toMatchObject({
          code: 'JOB_STATUS_CONFLICT',
          details: { status },
        });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Update for an unknown job', async () => {
      repository.get.mockRejectedValueOnce(new JobNotFoundError({ id: JOB_ID }));

      await expect(service.update({ id: JOB_ID, update: start(1) })).rejects.toBeInstanceOf(
        JobNotFoundError,
      );
    });
  });

  describe('create with an idempotency key', () => {
    const FINGERPRINT = 'f'.repeat(64);
    const KEY = 'order-4711';
    const request = {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
      priority: 7,
      maxAttempts: 4,
      idempotencyKey: KEY,
    } as const;
    const existing = (requestFingerprint: string | null = FINGERPRINT, job = storedJob()) => ({
      job: { ...job, idempotencyKey: KEY },
      run: 1,
      requestFingerprint,
    });

    beforeEach(() => {
      fingerprint.of.mockReturnValueOnce({ fingerprint: FINGERPRINT });
    });

    it('Job with a key: the key and the fingerprint are stored and the key looked up first', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });
      queue.enqueue.mockResolvedValueOnce({});

      const { job, created } = await service.create({ job: request });

      expect(fingerprint.of).toHaveBeenCalledExactlyOnceWith({ job: request });
      expect(repository.findByIdempotencyKeys).toHaveBeenCalledExactlyOnceWith({ keys: [KEY] });
      expect(repository.create).toHaveBeenCalledExactlyOnceWith({
        job: expect.objectContaining({
          idempotencyKey: KEY,
          requestFingerprint: FINGERPRINT,
        }) as unknown,
      });
      expect(created).toBe(true);
      expect(job.idempotencyKey).toBe(KEY);
      expect(queue.enqueue).toHaveBeenCalledOnce();
    });

    it('Job without a key: nothing is fingerprinted or looked up', async () => {
      queue.enqueue.mockResolvedValueOnce({});
      const { idempotencyKey: _key, ...withoutKey } = request;

      const { created } = await service.create({ job: withoutKey });

      expect(created).toBe(true);
      expect(fingerprint.of).not.toHaveBeenCalled();
      expect(repository.findByIdempotencyKeys).not.toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledExactlyOnceWith({
        job: expect.objectContaining({
          idempotencyKey: null,
          requestFingerprint: null,
        }) as unknown,
      });
    });

    it('Identical replay: the existing job is answered, nothing is stored or queued', async () => {
      const stored = existing();
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [stored] });

      const { job, created } = await service.create({ job: request });

      expect(job).toEqual(stored.job);
      expect(created).toBe(false);
      expect(repository.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('Same key, different payload: a conflict naming the existing job, nothing stored', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({
        jobs: [existing('0'.repeat(64))],
      });

      const rejection = service.create({ job: request });

      await expect(rejection).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
      await expect(rejection).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        details: { idempotencyKey: KEY, existingJobId: JOB_ID },
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('Replay of a flight transit after its departure day: the existing job is answered', async () => {
      const transit = {
        type: 'flight-transit',
        payload: { origin: 'LHR', destination: 'JFK', departureDate: '2026-10-28' },
        priority: 5,
        maxAttempts: 3,
        idempotencyKey: KEY,
      } as const;
      const stored = existing();
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [stored] });

      const { job, created } = await service.create({ job: transit });

      expect(job).toEqual(stored.job);
      expect(created).toBe(false);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('a new key does not exempt a flight transit from the departure day rule', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });

      await expect(
        service.create({
          job: {
            type: 'flight-transit',
            payload: { origin: 'LHR', destination: 'JFK', departureDate: '2026-10-28' },
            priority: 5,
            maxAttempts: 3,
            idempotencyKey: KEY,
          },
        }),
      ).rejects.toBeInstanceOf(InvalidJobPayloadError);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('Two submissions at the same time: the loser of the key race answers the winner job', async () => {
      const winner = existing();
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });
      repository.create.mockReset();
      repository.create.mockRejectedValueOnce(new IdempotencyKeyTakenError());
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [winner] });

      const { job, created } = await service.create({ job: request });

      expect(job).toEqual(winner.job);
      expect(created).toBe(false);
      expect(repository.findByIdempotencyKeys).toHaveBeenCalledTimes(2);
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    });

    it('a lost race whose winner has another request is a conflict', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });
      repository.create.mockReset();
      repository.create.mockRejectedValueOnce(new IdempotencyKeyTakenError());
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [existing('0'.repeat(64))] });

      await expect(service.create({ job: request })).rejects.toBeInstanceOf(
        IdempotencyKeyConflictError,
      );
    });

    it('a taken key whose job is gone again is not retried a second time', async () => {
      const taken = new IdempotencyKeyTakenError();
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });
      repository.create.mockReset();
      repository.create.mockRejectedValueOnce(taken);
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });

      await expect(service.create({ job: request })).rejects.toBe(taken);
      expect(repository.create).toHaveBeenCalledOnce();
    });
  });

  describe('createMany with idempotency keys', () => {
    const FINGERPRINTS = ['a'.repeat(64), 'b'.repeat(64)];
    const KEYS = ['order-1', 'order-2'];
    const ids = [randomUUID(), randomUUID(), randomUUID()];
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
    const departed = {
      type: 'flight-transit',
      payload: { origin: 'LHR', destination: 'JFK', departureDate: '2026-10-28' },
      priority: 5,
      maxAttempts: 3,
    } as const;
    const existing = (index: number, requestFingerprint = FINGERPRINTS[index]!) => ({
      job: storedJob({ id: ids[index]!, idempotencyKey: KEYS[index]! }),
      run: 1,
      requestFingerprint,
    });
    const nowPlus = (ms: number): string => new Date(Date.parse(NOW) + ms).toISOString();

    /** The repository stores the given jobs under the next ids, in order. */
    const storesBulk = (idsToUse: string[]): void => {
      repository.createMany.mockImplementationOnce((req) =>
        Promise.resolve({
          jobs: req.jobs.map(({ requestFingerprint: _fp, ...job }, index) => ({
            ...job,
            id: idsToUse[index]!,
            groupId: job.groupId ?? null,
            idempotencyKey: job.idempotencyKey ?? null,
            createdAt: job.createdAt ?? NOW,
            updatedAt: NOW,
          })),
        }),
      );
    };

    beforeEach(() => {
      fingerprint.of.mockReturnValueOnce({ fingerprint: FINGERPRINTS[0]! });
      fingerprint.of.mockReturnValueOnce({ fingerprint: FINGERPRINTS[1]! });
    });

    it('Bulk items carry their keys: keys and fingerprints are stored, one lookup for all keys', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });
      storesBulk([ids[0]!, ids[1]!, ids[2]!]);
      queue.enqueueMany.mockResolvedValueOnce({});

      const { jobs, created } = await service.createMany({
        jobs: [
          { ...email, idempotencyKey: KEYS[0]! },
          webhook,
          { ...email, idempotencyKey: KEYS[1]! },
        ],
      });

      expect(repository.findByIdempotencyKeys).toHaveBeenCalledExactlyOnceWith({ keys: KEYS });
      expect(fingerprint.of).toHaveBeenCalledTimes(2);
      expect(repository.createMany).toHaveBeenCalledExactlyOnceWith({
        jobs: [
          expect.objectContaining({
            idempotencyKey: KEYS[0],
            requestFingerprint: FINGERPRINTS[0],
          }) as unknown,
          expect.objectContaining({
            idempotencyKey: null,
            requestFingerprint: null,
          }) as unknown,
          expect.objectContaining({
            idempotencyKey: KEYS[1],
            requestFingerprint: FINGERPRINTS[1],
          }) as unknown,
        ],
      });
      expect(created).toBe(true);
      expect(jobs.map((job) => job.idempotencyKey)).toEqual([KEYS[0], null, KEYS[1]]);
    });

    it('Bulk without keys: no lookup', async () => {
      storesBulk([ids[0]!, ids[1]!]);
      queue.enqueueMany.mockResolvedValueOnce({});

      await service.createMany({ jobs: [email, webhook] });

      expect(fingerprint.of).not.toHaveBeenCalled();
      expect(repository.findByIdempotencyKeys).not.toHaveBeenCalled();
    });

    it('One item already exists: it is answered at its position and only the new job is stored and queued', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [existing(0)] });
      storesBulk([ids[1]!, ids[2]!]);
      queue.enqueueMany.mockResolvedValueOnce({});

      const { jobs, created } = await service.createMany({
        jobs: [{ ...email, idempotencyKey: KEYS[0]! }, webhook, email],
      });

      expect(jobs.map((job) => job.id)).toEqual([ids[0], ids[1], ids[2]]);
      expect(created).toBe(true);
      expect(repository.createMany).toHaveBeenCalledExactlyOnceWith({
        jobs: [
          expect.objectContaining({ type: 'webhook', createdAt: nowPlus(1) }) as unknown,
          expect.objectContaining({ type: 'email', createdAt: nowPlus(2) }) as unknown,
        ],
      });
      expect(queue.enqueueMany).toHaveBeenCalledExactlyOnceWith({
        entries: [
          { jobId: ids[1], run: 1, attempt: 1, priority: 5, runAt: null },
          { jobId: ids[2], run: 1, attempt: 1, priority: 7, runAt: null },
        ],
      });
      expect(logger.log).not.toHaveBeenCalledWith({ jobId: ids[0] }, 'Job submitted');
    });

    it('Every item already exists: nothing is stored or queued and created is false', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({
        jobs: [existing(1), existing(0)],
      });

      const { jobs, created } = await service.createMany({
        jobs: [
          { ...email, idempotencyKey: KEYS[0]! },
          { ...departed, idempotencyKey: KEYS[1]! },
        ],
      });

      expect(jobs.map((job) => job.id)).toEqual([ids[0], ids[1]]);
      expect(created).toBe(false);
      expect(repository.createMany).not.toHaveBeenCalled();
      expect(queue.enqueueMany).not.toHaveBeenCalled();
    });

    it('One item conflicts: the whole bulk is refused and nothing is stored', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({
        jobs: [existing(0), existing(1, '0'.repeat(64))],
      });

      const rejection = service.createMany({
        jobs: [
          { ...email, idempotencyKey: KEYS[0]! },
          { ...webhook, idempotencyKey: KEYS[1]! },
          email,
        ],
      });

      await expect(rejection).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
      await expect(rejection).rejects.toMatchObject({
        details: { idempotencyKey: KEYS[1], existingJobId: ids[1] },
      });
      expect(repository.createMany).not.toHaveBeenCalled();
      expect(queue.enqueueMany).not.toHaveBeenCalled();
    });

    it('a new item breaking a rule refuses the bulk even next to an existing item', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [existing(0)] });

      await expect(
        service.createMany({
          jobs: [{ ...email, idempotencyKey: KEYS[0]! }, departed],
        }),
      ).rejects.toMatchObject({
        details: {
          issues: [expect.objectContaining({ path: ['jobs', 1, 'payload', 'departureDate'] })],
        },
      });
      expect(repository.createMany).not.toHaveBeenCalled();
    });

    it('a key lost to a concurrent submission restarts the lookup and the insert', async () => {
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });
      repository.createMany.mockRejectedValueOnce(new IdempotencyKeyTakenError());
      repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [existing(0)] });
      storesBulk([ids[1]!]);
      queue.enqueueMany.mockResolvedValueOnce({});

      const { jobs, created } = await service.createMany({
        jobs: [{ ...email, idempotencyKey: KEYS[0]! }, webhook],
      });

      expect(jobs.map((job) => job.id)).toEqual([ids[0], ids[1]]);
      expect(created).toBe(true);
      expect(repository.createMany).toHaveBeenCalledTimes(2);
      expect(queue.enqueueMany).toHaveBeenCalledExactlyOnceWith({
        entries: [{ jobId: ids[1], run: 1, attempt: 1, priority: 5, runAt: null }],
      });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('a taken-key insert is retried up to the bound, then rethrown and logged', async () => {
      const taken = new IdempotencyKeyTakenError();
      for (let attempt = 0; attempt < BULK_INSERT_TRIES; attempt += 1) {
        repository.findByIdempotencyKeys.mockResolvedValueOnce({ jobs: [] });
        repository.createMany.mockRejectedValueOnce(taken);
      }

      await expect(
        service.createMany({ jobs: [{ ...email, idempotencyKey: KEYS[0]! }, webhook] }),
      ).rejects.toBe(taken);

      expect(repository.findByIdempotencyKeys).toHaveBeenCalledTimes(BULK_INSERT_TRIES);
      expect(repository.createMany).toHaveBeenCalledTimes(BULK_INSERT_TRIES);
      expect(queue.enqueueMany).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        { err: taken, tries: BULK_INSERT_TRIES },
        'Bulk not stored: its idempotency keys kept being taken by concurrent submissions',
      );
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
        repository.get.mockResolvedValueOnce({ job: current, run: 1, requestFingerprint: null });
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
        repository.get.mockResolvedValueOnce({ job: current, run: 1, requestFingerprint: null });
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
        repository.get.mockResolvedValueOnce({ job: current, run: 1, requestFingerprint: null });
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
          repository.get.mockResolvedValueOnce({
            job: storedJob({ status, attempts: 1 }),
            run: 1,
            requestFingerprint: null,
          });

          const change = service.changeStatus(cancel);

          await expect(change).rejects.toBeInstanceOf(JobStatusConflictError);
          await expect(change).rejects.toMatchObject({ details: { status } });
        }
        expect(repository.update).not.toHaveBeenCalled();
        expect(queue.cancel).not.toHaveBeenCalled();
      });

      it('Two cancels at the same time: the losing write is a conflict and announces nothing', async () => {
        repository.get.mockResolvedValueOnce({
          job: storedJob(),
          run: 1,
          requestFingerprint: null,
        });
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
          // The time of the last automatic retry, still on the job.
          scheduledAt: '2026-10-29T11:29:30.000Z',
          startedAt: '2026-10-29T11:30:00.000Z',
          completedAt: '2026-10-29T11:31:00.000Z',
        });

      it('Retry a failed job', async () => {
        repository.get.mockResolvedValueOnce({ job: failed(), run: 2, requestFingerprint: null });
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
            scheduledAt: null,
            run: 3,
          },
        });
        expect(job).toEqual({
          ...failed(),
          status: 'pending',
          attempts: 0,
          error: null,
          scheduledAt: null,
          startedAt: null,
          completedAt: null,
        });
        expect(queue.cancel).not.toHaveBeenCalled();
      });

      it('Retried job is queued', async () => {
        repository.get.mockResolvedValueOnce({ job: failed(), run: 2, requestFingerprint: null });
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
        repository.get.mockResolvedValueOnce({ job: failed(), run: 1, requestFingerprint: null });
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
          repository.get.mockResolvedValueOnce({
            job: storedJob({ status, attempts: 1 }),
            run: 1,
            requestFingerprint: null,
          });

          const change = service.changeStatus(retry);

          await expect(change).rejects.toBeInstanceOf(JobStatusConflictError);
          await expect(change).rejects.toMatchObject({ details: { status } });
        }
        expect(repository.update).not.toHaveBeenCalled();
        expect(queue.enqueue).not.toHaveBeenCalled();
      });

      it('Two retries at the same time: the losing write is a conflict and queues nothing', async () => {
        repository.get.mockResolvedValueOnce({ job: failed(), run: 1, requestFingerprint: null });
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
          jobs: req.jobs.map(({ requestFingerprint: _fp, ...job }, index) => ({
            ...job,
            id: ids[index]!,
            groupId: null,
            idempotencyKey: null,
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
        requestFingerprint: null,
      });
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 2 }),
        run: 1,
        requestFingerprint: null,
      });

      await service.update({ id: JOB_ID, update: { status: 'processing', run: 1, attempt: 2 } });
      await service.update({
        id: JOB_ID,
        update: { status: 'completed', run: 1, attempt: 2, result: { messageId: 'm-1' } },
      });

      expect(logger.log.mock.calls).toEqual([
        [{ jobId: JOB_ID, attempt: 2 }, 'Attempt started'],
        [{ jobId: JOB_ID, attempt: 2 }, 'Job completed'],
      ]);
    });

    it('Failed attempt with a retry is logged', async () => {
      acceptsWrite();
      queue.enqueue.mockResolvedValueOnce({});
      retryDelay.of.mockReturnValueOnce({ delayMs: 5_000 });
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 }),
        run: 1,
        requestFingerprint: null,
      });

      await service.update({ id: JOB_ID, update: { status: 'failed', run: 1, attempt: 1, error } });

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
        requestFingerprint: null,
      });

      await service.update({ id: JOB_ID, update: { status: 'failed', run: 1, attempt: 3, error } });

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
        requestFingerprint: null,
      });
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'pending', attempts: 0 }),
        run: 1,
        requestFingerprint: null,
      });

      await expect(
        service.update({ id: JOB_ID, update: { status: 'processing', run: 1, attempt: 2 } }),
      ).rejects.toMatchObject({ code: 'JOB_STATUS_CONFLICT' });
      await expect(
        service.update({ id: JOB_ID, update: { status: 'failed', run: 1, attempt: 1, error } }),
      ).rejects.toMatchObject({ code: 'JOB_STATUS_CONFLICT' });

      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs nothing when another worker cancelled the job first', async () => {
      repository.get.mockResolvedValueOnce({ job: storedJob(), run: 1, requestFingerprint: null });
      repository.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'cancelled' }),
      );
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'cancelled' }),
        run: 1,
        requestFingerprint: null,
      });

      await expect(
        service.update({ id: JOB_ID, update: { status: 'processing', run: 1, attempt: 1 } }),
      ).rejects.toBeInstanceOf(JobStatusConflictError);

      expect(logger.log).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });
});
