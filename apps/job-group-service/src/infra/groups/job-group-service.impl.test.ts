import { randomUUID } from 'node:crypto';

import type { JobGroup } from '@job-queue/contracts';
import {
  JobServiceUnavailableError,
  type PageLimit,
  QueryLimitExceededError,
} from '@job-queue/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import { JobGroupNotEmptyError } from '../../domain/groups/errors/job-group-not-empty.error.js';
import { JobGroupNotFoundError } from '../../domain/groups/errors/job-group-not-found.error.js';
import type { GroupChildJobs } from '../../domain/groups/group-child-jobs.js';
import type { JobGroupRepository } from '../../domain/groups/job-group-repository.js';

import { JobGroupServiceImpl } from './job-group-service.impl.js';

describe('JobGroupServiceImpl', () => {
  let repository: DeepMockProxy<JobGroupRepository>;
  let childJobs: DeepMockProxy<GroupChildJobs>;
  let pageLimit: DeepMockProxy<PageLimit>;
  let service: JobGroupServiceImpl;
  const id = randomUUID();

  const group = (id: string): JobGroup => {
    return {
      id,
      status: 'running',
      total: 0,
      completed: 0,
      failed: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      checkedAt: null,
      finishedAt: null,
    };
  };

  beforeEach(() => {
    repository = mockDeep<JobGroupRepository>();
    childJobs = mockDeep<GroupChildJobs>();
    pageLimit = mockDeep<PageLimit>();
    service = new JobGroupServiceImpl({ repository, childJobs, pageLimit });
  });

  describe('create', () => {
    it('stores a new group and returns it', async () => {
      repository.create.mockResolvedValueOnce({ group: group(id) });

      await expect(service.create()).resolves.toEqual({ group: group(id) });
      expect(repository.create).toHaveBeenCalledOnce();
    });
  });

  describe('get', () => {
    it('returns the stored group without asking job-service', async () => {
      repository.get.mockResolvedValueOnce({ group: group(id) });

      await expect(service.get({ id })).resolves.toEqual({ group: group(id) });
      expect(repository.get).toHaveBeenCalledExactlyOnceWith({ id });
      expect(childJobs.count).not.toHaveBeenCalled();
    });

    it('throws JobGroupNotFoundError for an unknown group', async () => {
      repository.get.mockResolvedValueOnce({ group: null });

      await expect(service.get({ id })).rejects.toMatchObject({
        code: 'JOB_GROUP_NOT_FOUND',
        details: { id },
      });
      expect(childJobs.count).not.toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('asks the page limit for the size and reads that page, newest first', async () => {
      pageLimit.resolve.mockReturnValueOnce({ limit: 20 });
      repository.query.mockResolvedValueOnce({ items: [group(id)], total: 1 });

      await expect(service.query({ offset: 5 })).resolves.toEqual({
        items: [group(id)],
        total: 1,
      });
      expect(pageLimit.resolve).toHaveBeenCalledExactlyOnceWith({ limit: undefined });
      expect(repository.query).toHaveBeenCalledExactlyOnceWith({ limit: 20, offset: 5 });
    });

    it('passes an asked limit to the page limit and the offset on', async () => {
      pageLimit.resolve.mockReturnValueOnce({ limit: 7 });
      repository.query.mockResolvedValueOnce({ items: [], total: 0 });

      await service.query({ limit: 7, offset: 3 });

      expect(pageLimit.resolve).toHaveBeenCalledExactlyOnceWith({ limit: 7 });
      expect(repository.query).toHaveBeenCalledExactlyOnceWith({ limit: 7, offset: 3 });
    });

    it('passes the page-limit error on and reads nothing', async () => {
      const failure = new QueryLimitExceededError({ maxLimit: 100 });
      pageLimit.resolve.mockImplementationOnce(() => {
        throw failure;
      });

      await expect(service.query({ limit: 101, offset: 0 })).rejects.toBe(failure);
      expect(repository.query).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('throws JobGroupNotFoundError for a missing group without calling job-service', async () => {
      repository.get.mockResolvedValueOnce({ group: null });

      await expect(service.delete({ id })).rejects.toThrow(JobGroupNotFoundError);
      expect(childJobs.count).not.toHaveBeenCalled();
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('throws JobGroupNotEmptyError with the count and does not delete when children exist', async () => {
      repository.get.mockResolvedValueOnce({ group: group(id) });
      childJobs.count.mockResolvedValueOnce({ total: 1, completed: 0, failed: 0 });

      const error = await service.delete({ id }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JobGroupNotEmptyError);
      expect((error as JobGroupNotEmptyError).details).toEqual({ id, total: 1 });
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('lets JobServiceUnavailableError through and does not delete', async () => {
      repository.get.mockResolvedValueOnce({ group: group(id) });
      const unavailable = new JobServiceUnavailableError({ reason: 'down' });
      childJobs.count.mockRejectedValueOnce(unavailable);

      await expect(service.delete({ id })).rejects.toBe(unavailable);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('deletes when the count is 0', async () => {
      repository.get.mockResolvedValueOnce({ group: group(id) });
      childJobs.count.mockResolvedValueOnce({ total: 0, completed: 0, failed: 0 });
      repository.delete.mockResolvedValueOnce({ deleted: true });

      await expect(service.delete({ id })).resolves.toEqual({});
      expect(childJobs.count).toHaveBeenCalledExactlyOnceWith({ groupId: id });
      expect(repository.delete).toHaveBeenCalledExactlyOnceWith({ id });
    });

    it('throws JobGroupNotFoundError when the group vanished before the delete', async () => {
      repository.get.mockResolvedValueOnce({ group: group(id) });
      childJobs.count.mockResolvedValueOnce({ total: 0, completed: 0, failed: 0 });
      repository.delete.mockResolvedValueOnce({ deleted: false });

      await expect(service.delete({ id })).rejects.toMatchObject({
        code: 'JOB_GROUP_NOT_FOUND',
        details: { id },
      });
    });
  });
});
