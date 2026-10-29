import { FINISHED_JOB_STATUSES, type Job } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import { InvalidJobResultError } from '../../domain/jobs/errors/invalid-job-result.error.js';
import { JobQueueUnavailableError } from '../../domain/jobs/errors/job-queue-unavailable.error.js';
import { JobStatusConflictError } from '../../domain/jobs/errors/job-status-conflict.error.js';
import { QueryLimitExceededError } from '../../domain/jobs/errors/query-limit-exceeded.error.js';
import type { JobQueue } from '../../domain/jobs/job-queue.js';
import type { JobRepository } from '../../domain/jobs/job-repository.js';
import { JobServiceImpl } from './job-service.impl.js';

const JOB_ID = '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b';
const NOW = '2026-10-29T12:00:00.000Z';
const PARAMS = { queryDefaultLimit: 20, queryMaxLimit: 100 };

describe('JobServiceImpl', () => {
  let repository: DeepMockProxy<JobRepository>;
  let queue: DeepMockProxy<JobQueue>;
  let clock: DeepMockProxy<Clock>;
  let logger: DeepMockProxy<Pick<LoggerService, 'warn'>>;
  let service: JobServiceImpl;

  const storedJob = (overrides: Partial<Job> = {}): Job => ({
    id: JOB_ID,
    type: 'email',
    payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
    status: 'pending',
    priority: 5,
    attempts: 0,
    maxAttempts: 3,
    result: null,
    error: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-29T11:00:00.000Z',
    updatedAt: '2026-10-29T11:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    repository = mockDeep<JobRepository>();
    queue = mockDeep<JobQueue>();
    clock = mockDeep<Clock>();
    logger = mockDeep<Pick<LoggerService, 'warn'>>();
    clock.now.mockReturnValueOnce({ now: new Date(NOW) });
    repository.create.mockImplementationOnce((req) =>
      Promise.resolve({ job: { ...req.job, id: JOB_ID, createdAt: NOW, updatedAt: NOW } }),
    );
    service = new JobServiceImpl({ repository, queue, clock, logger }, PARAMS);
  });

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
      expect(repository.create).toHaveBeenCalledWith({ job: expected });
      expect(job).toEqual({ ...expected, id: JOB_ID, createdAt: NOW, updatedAt: NOW });
    });

    it('Submitted job is queued', async () => {
      queue.enqueue.mockResolvedValueOnce({});
      await service.create({ job: request });

      expect(queue.enqueue).toHaveBeenCalledWith({ jobId: JOB_ID, attempt: 1 });
    });

    it('Queue unavailable during submit', async () => {
      queue.enqueue.mockRejectedValueOnce(
        new JobQueueUnavailableError({ jobId: JOB_ID, attempt: 1 }),
      );

      const { job } = await service.create({ job: request });

      expect(job.status).toBe('pending');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID, attempt: 1 }),
        expect.any(String),
      );
    });
  });

  describe('get', () => {
    it('returns the stored job', async () => {
      repository.get.mockResolvedValueOnce({ job: storedJob() });

      await expect(service.get({ id: JOB_ID })).resolves.toEqual({ job: storedJob() });
    });
  });

  describe('query', () => {
    beforeEach(() => {
      repository.query.mockResolvedValueOnce({ items: [storedJob()], total: 1 });
    });

    it('passes the requested page through', async () => {
      await expect(service.query({ limit: 2, offset: 1 })).resolves.toEqual({
        items: [storedJob()],
        total: 1,
      });
      expect(repository.query).toHaveBeenCalledWith({ limit: 2, offset: 1 });
    });

    it('Default page size', async () => {
      await service.query({ offset: 0 });

      expect(repository.query).toHaveBeenCalledWith({ limit: PARAMS.queryDefaultLimit, offset: 0 });
    });

    it('Limit above maximum', async () => {
      await expect(
        service.query({ limit: PARAMS.queryMaxLimit + 1, offset: 0 }),
      ).rejects.toBeInstanceOf(QueryLimitExceededError);
      expect(repository.query).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const error = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };

    /** The repository accepts the next write and returns the job with the changes applied. */
    const acceptsWrite = (): void => {
      repository.update.mockImplementationOnce((req) =>
        Promise.resolve({ job: { ...storedJob(), ...req.changes } as Job }),
      );
    };

    it('Start a pending job', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({ job: storedJob({ status: 'pending', attempts: 0 }) });

      const { job } = await service.update({ id: JOB_ID, update: { status: 'processing' } });

      expect(repository.update).toHaveBeenCalledWith({
        id: JOB_ID,
        expected: { status: 'pending', attempts: 0 },
        changes: { status: 'processing', attempts: 1, startedAt: NOW },
      });
      expect(job.status).toBe('processing');
    });

    it('Start a job that is not pending', async () => {
      for (const status of ['processing', 'completed', 'failed'] as const) {
        repository.get.mockResolvedValueOnce({ job: storedJob({ status, attempts: 1 }) });

        const update = service.update({ id: JOB_ID, update: { status: 'processing' } });

        await expect(update).rejects.toBeInstanceOf(JobStatusConflictError);
        await expect(update).rejects.toMatchObject({ details: { status } });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('Two workers start the same job', async () => {
      repository.get.mockResolvedValueOnce({ job: storedJob() });
      repository.update.mockRejectedValueOnce(
        new JobStatusConflictError({ id: JOB_ID, status: 'processing' }),
      );

      await expect(
        service.update({ id: JOB_ID, update: { status: 'processing' } }),
      ).rejects.toBeInstanceOf(JobStatusConflictError);
    });

    it('Complete a processing job', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1 }),
      });

      await service.update({
        id: JOB_ID,
        update: { status: 'completed', result: { messageId: 'm-1' } },
      });

      expect(repository.update).toHaveBeenCalledWith({
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
    });

    it('Complete a job that is not processing', async () => {
      for (const status of ['pending', 'completed', 'failed'] as const) {
        repository.get.mockResolvedValueOnce({ job: storedJob({ status, attempts: 1 }) });

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
      });

      const { job } = await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(repository.update).toHaveBeenCalledWith({
        id: JOB_ID,
        expected: { status: 'processing', attempts: 1 },
        changes: { status: 'pending', error, completedAt: null },
      });
      expect(job.status).toBe('pending');
      expect(queue.enqueue).toHaveBeenCalledWith({ jobId: JOB_ID, attempt: 2 });
    });

    it('Retry survives an unavailable queue', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 1, maxAttempts: 3 }),
      });
      queue.enqueue.mockRejectedValueOnce(
        new JobQueueUnavailableError({ jobId: JOB_ID, attempt: 2 }),
      );

      const { job } = await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(job.status).toBe('pending');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID, attempt: 2 }),
        expect.any(String),
      );
    });

    it('Failure on the last attempt', async () => {
      acceptsWrite();
      repository.get.mockResolvedValueOnce({
        job: storedJob({ status: 'processing', attempts: 3, maxAttempts: 3 }),
      });

      const { job } = await service.update({ id: JOB_ID, update: { status: 'failed', error } });

      expect(repository.update).toHaveBeenCalledWith({
        id: JOB_ID,
        expected: { status: 'processing', attempts: 3 },
        changes: { status: 'failed', error, completedAt: NOW },
      });
      expect(job.status).toBe('failed');
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('Fail a job that is not processing', async () => {
      for (const status of ['pending', 'completed', 'failed'] as const) {
        repository.get.mockResolvedValueOnce({ job: storedJob({ status, attempts: 1 }) });

        await expect(
          service.update({ id: JOB_ID, update: { status: 'failed', error } }),
        ).rejects.toMatchObject({ code: 'JOB_STATUS_CONFLICT', details: { status } });
      }
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('Delete a finished job', async () => {
      repository.delete.mockResolvedValueOnce({});

      await expect(service.delete({ id: JOB_ID })).resolves.toEqual({});
      expect(repository.delete).toHaveBeenCalledWith({
        id: JOB_ID,
        allowedStatuses: FINISHED_JOB_STATUSES,
      });
    });
  });
});
