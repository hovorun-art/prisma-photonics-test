import { randomUUID } from 'node:crypto';

import type { JobGroup } from '@job-queue/contracts';
import { type Clock, JobServiceUnavailableError } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { GroupChildJobs } from '../../domain/groups/group-child-jobs.js';
import type { JobGroupRepository } from '../../domain/groups/job-group-repository.js';

import { JobGroupTrackerImpl } from './job-group-tracker.impl.js';

const NOW = '2026-10-30T12:00:00.000Z';
const BATCH_SIZE = 2;

describe('JobGroupTrackerImpl', () => {
  let repository: DeepMockProxy<JobGroupRepository>;
  let childJobs: DeepMockProxy<GroupChildJobs>;
  let clock: DeepMockProxy<Clock>;
  let logger: DeepMockProxy<Pick<LoggerService, 'error'>>;
  let tracker: JobGroupTrackerImpl;
  const id = randomUUID();

  const running = (groupId: string, total = 0): JobGroup => ({
    id: groupId,
    status: 'running',
    total,
    completed: 0,
    failed: 0,
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
    checkedAt: null,
    finishedAt: null,
  });

  const clockOnce = (): void => {
    clock.now.mockImplementationOnce(() => ({ now: new Date() }));
  };

  const oneRunning = (stored: JobGroup): void => {
    repository.listOpen.mockResolvedValueOnce({ groups: [stored] });
    clockOnce();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    repository = mockDeep<JobGroupRepository>();
    childJobs = mockDeep<GroupChildJobs>();
    clock = mockDeep<Clock>();
    logger = mockDeep<Pick<LoggerService, 'error'>>();
    tracker = new JobGroupTrackerImpl(
      { repository, childJobs, clock, logger },
      { batchSize: BATCH_SIZE },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('stats', () => {
    it('Children submitted after creation: stores the reported total and checkedAt', async () => {
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 3, completed: 0, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 1, failedChecks: 0 });

      expect(childJobs.count).toHaveBeenCalledExactlyOnceWith({ groupId: id });
      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith({
        id,
        status: 'running',
        total: 3,
        completed: 0,
        failed: 0,
        checkedAt: NOW,
        finishedAt: null,
      });
    });

    it('Counts by outcome: completed and failed come from the reported counts', async () => {
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 4, completed: 1, failed: 2 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith({
        id,
        status: 'running',
        total: 4,
        completed: 1,
        failed: 2,
        checkedAt: NOW,
        finishedAt: null,
      });
    });

    it('Deleted child counts as failed: the stored total stays and the missing child is failed', async () => {
      oneRunning(running(id, 3));
      childJobs.count.mockResolvedValueOnce({ total: 2, completed: 2, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith({
        id,
        status: 'failed',
        total: 3,
        completed: 2,
        failed: 1,
        checkedAt: NOW,
        finishedAt: NOW,
      });
    });

    it('Children submitted in several requests: a larger later total replaces the stored one', async () => {
      oneRunning(running(id, 2));
      childJobs.count.mockResolvedValueOnce({ total: 4, completed: 1, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ total: 4, completed: 1, failed: 0, status: 'running' }),
      );
    });
  });

  describe('status', () => {
    it('Group without children keeps running: total 0 never finishes the group', async () => {
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 0, completed: 0, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith({
        id,
        status: 'running',
        total: 0,
        completed: 0,
        failed: 0,
        checkedAt: NOW,
        finishedAt: null,
      });
    });

    it('Some children still running: the group stays running without finishedAt', async () => {
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 2, completed: 1, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: 'running', finishedAt: null }),
      );
    });

    it('All children completed: the group completes and finishedAt is set', async () => {
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 3, completed: 3, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith({
        id,
        status: 'completed',
        total: 3,
        completed: 3,
        failed: 0,
        checkedAt: NOW,
        finishedAt: NOW,
      });
    });

    it('A child failed: the finished group is failed', async () => {
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 3, completed: 2, failed: 1 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: 'failed', failed: 1, finishedAt: NOW }),
      );
    });

    it('A child was cancelled: the finished group with one cancelled child is failed', async () => {
      oneRunning(running(id, 2));
      // GroupChildJobs counts cancelled children in `failed` (see the HttpGroupChildJobs test).
      childJobs.count.mockResolvedValueOnce({ total: 2, completed: 1, failed: 1 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith({
        id,
        status: 'failed',
        total: 2,
        completed: 1,
        failed: 1,
        checkedAt: NOW,
        finishedAt: NOW,
      });
    });

    describe('a failed group', () => {
      const FAILED_AT = '2026-10-30T11:00:00.000Z';
      const failed = (): JobGroup => ({
        ...running(id, 2),
        status: 'failed',
        completed: 1,
        failed: 1,
        checkedAt: FAILED_AT,
        finishedAt: FAILED_AT,
      });

      it('runs again when a failed child was retried', async () => {
        oneRunning(failed());
        childJobs.count.mockResolvedValueOnce({ total: 2, completed: 1, failed: 0 });
        repository.recordCheck.mockResolvedValueOnce({ recorded: true });

        await tracker.checkOpen();

        expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ status: 'running', failed: 0, finishedAt: null }),
        );
      });

      it('completes when the retried child completed', async () => {
        oneRunning(failed());
        childJobs.count.mockResolvedValueOnce({ total: 2, completed: 2, failed: 0 });
        repository.recordCheck.mockResolvedValueOnce({ recorded: true });

        await tracker.checkOpen();

        expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ status: 'completed', completed: 2, finishedAt: NOW }),
        );
      });

      it('keeps the time it finished while it stays failed', async () => {
        oneRunning(failed());
        childJobs.count.mockResolvedValueOnce({ total: 2, completed: 1, failed: 1 });
        repository.recordCheck.mockResolvedValueOnce({ recorded: true });

        await tracker.checkOpen();

        expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ status: 'failed', checkedAt: NOW, finishedAt: FAILED_AT }),
        );
      });
    });

    it('A failed child does not stop the others: only count is called, never anything that changes jobs', async () => {
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 3, completed: 0, failed: 1 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await tracker.checkOpen();

      expect(childJobs.count).toHaveBeenCalledOnce();
      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: 'running', finishedAt: null }),
      );
    });

    it('a group the store no longer records is not counted as checked', async () => {
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 1, completed: 1, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: false });

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 0, failedChecks: 0 });
    });
  });

  describe('failed polls', () => {
    it('job-service down during a poll: nothing is recorded and the failure is logged with the group id', async () => {
      oneRunning(running(id, 2));
      const error = new JobServiceUnavailableError({ reason: 'down' });
      childJobs.count.mockRejectedValueOnce(error);

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 0, failedChecks: 1 });

      expect(repository.recordCheck).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        { err: error, groupId: id },
        expect.any(String),
      );
    });

    it('an unexpected answer is handled like an outage: logged, not recorded', async () => {
      oneRunning(running(id));
      const error = new Error('unparseable body');
      childJobs.count.mockRejectedValueOnce(error);

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 0, failedChecks: 1 });

      expect(repository.recordCheck).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        { err: error, groupId: id },
        expect.any(String),
      );
    });

    it('a failing recordCheck is logged and counted as a failed check', async () => {
      oneRunning(running(id));
      const error = new Error('database down');
      childJobs.count.mockResolvedValueOnce({ total: 1, completed: 0, failed: 0 });
      repository.recordCheck.mockRejectedValueOnce(error);

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 0, failedChecks: 1 });

      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        { err: error, groupId: id },
        expect.any(String),
      );
    });

    it('job-service back: the next poll records the current counts', async () => {
      oneRunning(running(id));
      childJobs.count.mockRejectedValueOnce(new JobServiceUnavailableError({ reason: 'down' }));
      await tracker.checkOpen();

      vi.setSystemTime(new Date('2026-10-30T12:00:02.000Z'));
      oneRunning(running(id));
      childJobs.count.mockResolvedValueOnce({ total: 2, completed: 1, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 1, failedChecks: 0 });

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ total: 2, completed: 1, checkedAt: '2026-10-30T12:00:02.000Z' }),
      );
    });

    it('one group failing does not stop the next group', async () => {
      const otherId = randomUUID();
      repository.listOpen.mockResolvedValueOnce({
        groups: [running(id), running(otherId)],
      });
      repository.listOpen.mockResolvedValueOnce({ groups: [] });
      clockOnce();
      childJobs.count.mockRejectedValueOnce(new JobServiceUnavailableError({ reason: 'down' }));
      childJobs.count.mockResolvedValueOnce({ total: 1, completed: 0, failed: 0 });
      repository.recordCheck.mockResolvedValueOnce({ recorded: true });

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 1, failedChecks: 1 });

      expect(repository.recordCheck).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: otherId, total: 1 }),
      );
    });
  });

  describe('paging', () => {
    it('reads running groups page by page after the last id until a short page', async () => {
      const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
      repository.listOpen.mockResolvedValueOnce({ groups: [running(a), running(b)] });
      repository.listOpen.mockResolvedValueOnce({ groups: [running(c)] });
      for (let i = 0; i < 3; i++) {
        childJobs.count.mockResolvedValueOnce({ total: 0, completed: 0, failed: 0 });
        repository.recordCheck.mockResolvedValueOnce({ recorded: true });
        clockOnce();
      }

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 3, failedChecks: 0 });

      expect(repository.listOpen).toHaveBeenNthCalledWith(1, { limit: BATCH_SIZE });
      expect(repository.listOpen).toHaveBeenNthCalledWith(2, {
        limit: BATCH_SIZE,
        afterId: b,
      });
      expect(repository.listOpen).toHaveBeenCalledTimes(2);
    });

    it('asks for one more page after a full page and stops on an empty one', async () => {
      const [a, b] = [randomUUID(), randomUUID()];
      repository.listOpen.mockResolvedValueOnce({ groups: [running(a), running(b)] });
      repository.listOpen.mockResolvedValueOnce({ groups: [] });
      for (let i = 0; i < 2; i++) {
        childJobs.count.mockResolvedValueOnce({ total: 0, completed: 0, failed: 0 });
        repository.recordCheck.mockResolvedValueOnce({ recorded: true });
        clockOnce();
      }

      await tracker.checkOpen();

      expect(repository.listOpen).toHaveBeenCalledTimes(2);
      expect(repository.listOpen).toHaveBeenLastCalledWith({ limit: BATCH_SIZE, afterId: b });
    });

    it('lets a failing group read reject the poll without checking anything', async () => {
      const error = new Error('database down');
      repository.listOpen.mockRejectedValueOnce(error);

      await expect(tracker.checkOpen()).rejects.toBe(error);

      expect(childJobs.count).not.toHaveBeenCalled();
      expect(repository.recordCheck).not.toHaveBeenCalled();
    });

    it('keeps the first page recorded when the second page read fails', async () => {
      const [a, b] = [randomUUID(), randomUUID()];
      const error = new Error('database down');
      repository.listOpen.mockResolvedValueOnce({ groups: [running(a), running(b)] });
      repository.listOpen.mockRejectedValueOnce(error);
      for (let i = 0; i < 2; i++) {
        childJobs.count.mockResolvedValueOnce({ total: 0, completed: 0, failed: 0 });
        repository.recordCheck.mockResolvedValueOnce({ recorded: true });
        clockOnce();
      }

      await expect(tracker.checkOpen()).rejects.toBe(error);

      expect(repository.recordCheck).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no group is running', async () => {
      repository.listOpen.mockResolvedValueOnce({ groups: [] });

      await expect(tracker.checkOpen()).resolves.toEqual({ checked: 0, failedChecks: 0 });

      expect(childJobs.count).not.toHaveBeenCalled();
    });
  });
});
