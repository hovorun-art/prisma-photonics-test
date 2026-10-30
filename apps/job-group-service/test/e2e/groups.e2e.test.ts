import { randomUUID } from 'node:crypto';

import { JOB_GROUPS_ROUTE, JobGroup } from '@job-queue/contracts';
import { CLOCK, type Clock, JobServiceUnavailableError } from '@job-queue/kernel';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobGroupServiceUnderTest, TEST_CONFIG } from './job-group-service-under-test.js';

const UNAVAILABLE = new JobServiceUnavailableError({ reason: 'connect ECONNREFUSED' });
const NO_CHILDREN = { total: 0, completed: 0, failed: 0 };

interface OpenApiOperation {
  responses: Record<string, unknown>;
  parameters?: { name: string; in: string }[];
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
}

describe('job group routes', () => {
  let service: JobGroupServiceUnderTest;

  beforeAll(async () => {
    service = await JobGroupServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await service.close();
  });

  describe('create', () => {
    it('New group', async () => {
      const response = await service.create();

      expect(response.status).toBe(201);
      const group = JobGroup.parse(await response.json());
      expect(group).toMatchObject({
        status: 'running',
        total: 0,
        completed: 0,
        failed: 0,
        checkedAt: null,
        finishedAt: null,
      });
      expect(service.childJobs.count).not.toHaveBeenCalled();
    });

    it('Each group has its own id', async () => {
      const first = await service.created();
      const second = await service.created();

      expect(first.id).not.toBe(second.id);
    });

    it('ignores a body sent with the create request', async () => {
      const response = await fetch(service.url(JOB_GROUPS_ROUTE), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ "total": 5, not json',
      });

      expect(response.status).toBe(201);
      expect(JobGroup.parse(await response.json()).total).toBe(0);
    });
  });

  describe('get', () => {
    it('Existing group', async () => {
      const group = await service.created();

      expect(await service.group(group.id)).toEqual(group);
    });

    it('Group read while job-service is down', async () => {
      const group = await service.seed({ status: 'running', total: 3, completed: 1, failed: 1 });
      service.childJobs.count.mockRejectedValueOnce(UNAVAILABLE);
      await service.poll();

      expect(await service.group(group.id)).toEqual(group);
      expect(service.childJobs.count).toHaveBeenCalledExactlyOnceWith({ groupId: group.id });
    });

    it('Unknown group', async () => {
      const id = randomUUID();

      const body = await service.errorBody({
        response: await service.get(id),
        status: 404,
        code: 'JOB_GROUP_NOT_FOUND',
      });
      expect(body.details).toEqual({ id });
    });

    it('Malformed group id', async () => {
      expect(await service.issuePaths(await service.get('not-a-uuid'))).toEqual([['id']]);
    });
  });

  describe('list', () => {
    it('Newest first', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push((await service.created()).id);
        await service.nextMillisecond();
      }

      const page = await service.listed();

      expect(page.items.map((group) => group.id)).toEqual(ids.reverse());
      expect(page.total).toBe(3);
    });

    it('Paging', async () => {
      const oldest = await service.created();
      await service.nextMillisecond();
      await service.created();
      await service.nextMillisecond();
      await service.created();

      const page = await service.listed('limit=2&offset=2');

      expect(page.items.map((group) => group.id)).toEqual([oldest.id]);
      expect(page.total).toBe(3);
    });

    it('Default page size', async () => {
      for (let i = 0; i <= TEST_CONFIG.queryDefaultLimit; i += 1) await service.created();

      const page = await service.listed();

      expect(page.items).toHaveLength(TEST_CONFIG.queryDefaultLimit);
      expect(page.total).toBe(TEST_CONFIG.queryDefaultLimit + 1);
    });

    it('Limit above the maximum', async () => {
      const response = await service.list(`limit=${TEST_CONFIG.queryMaxLimit + 1}`);

      expect(await service.issuePaths(response)).toEqual([['limit']]);
    });

    it('accepts the maximum limit', async () => {
      await service.created();

      const page = await service.listed(`limit=${TEST_CONFIG.queryMaxLimit}`);

      expect(page.total).toBe(1);
    });

    it('Invalid paging values', async () => {
      expect(await service.issuePaths(await service.list('limit=0'))).toEqual([['limit']]);
      expect(await service.issuePaths(await service.list('offset=-1'))).toEqual([['offset']]);
    });

    it('No groups', async () => {
      expect(await service.listed()).toEqual({ items: [], total: 0 });
    });
  });

  describe('delete', () => {
    it('Group whose submit failed', async () => {
      const group = await service.created();
      service.childJobs.count.mockResolvedValueOnce(NO_CHILDREN);

      const response = await service.remove(group.id);

      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(service.childJobs.count).toHaveBeenCalledExactlyOnceWith({ groupId: group.id });
      await service.errorBody({
        response: await service.get(group.id),
        status: 404,
        code: 'JOB_GROUP_NOT_FOUND',
      });
    });

    it('Group with children', async () => {
      const group = await service.created();
      service.childJobs.count.mockResolvedValueOnce({ total: 2, completed: 0, failed: 0 });

      const body = await service.errorBody({
        response: await service.remove(group.id),
        status: 409,
        code: 'JOB_GROUP_NOT_EMPTY',
      });

      expect(body.details).toEqual({ id: group.id, total: 2 });
      expect(await service.group(group.id)).toEqual(group);
    });

    it('job-service unreachable on delete', async () => {
      const group = await service.created();
      service.childJobs.count.mockRejectedValueOnce(UNAVAILABLE);

      await service.errorBody({
        response: await service.remove(group.id),
        status: 503,
        code: 'JOB_SERVICE_UNAVAILABLE',
      });

      expect(await service.group(group.id)).toEqual(group);
    });

    it('Delete unknown group', async () => {
      await service.errorBody({
        response: await service.remove(randomUUID()),
        status: 404,
        code: 'JOB_GROUP_NOT_FOUND',
      });
      expect(service.childJobs.count).not.toHaveBeenCalled();
    });

    it('Delete with malformed id', async () => {
      expect(await service.issuePaths(await service.remove('not-a-uuid'))).toEqual([['id']]);
      expect(service.childJobs.count).not.toHaveBeenCalled();
    });
  });

  describe('polling', () => {
    it('Children submitted after creation', async () => {
      const group = await service.created();
      service.childJobs.count.mockResolvedValueOnce({ total: 3, completed: 0, failed: 0 });

      await service.poll();

      const polled = await service.group(group.id);
      expect(polled).toMatchObject({ status: 'running', total: 3, completed: 0, failed: 0 });
      expect(polled.checkedAt).not.toBeNull();
      expect(service.childJobs.count).toHaveBeenCalledExactlyOnceWith({ groupId: group.id });
    });

    it('All children completed', async () => {
      const group = await service.created();
      service.childJobs.count.mockResolvedValueOnce({ total: 2, completed: 2, failed: 0 });

      await service.poll();

      const polled = await service.group(group.id);
      expect(polled).toMatchObject({ status: 'completed', total: 2, completed: 2, failed: 0 });
      expect(polled.finishedAt).not.toBeNull();
    });

    it('A child failed', async () => {
      const group = await service.created();
      service.childJobs.count.mockResolvedValueOnce({ total: 3, completed: 2, failed: 1 });

      await service.poll();

      const polled = await service.group(group.id);
      expect(polled).toMatchObject({ status: 'failed', total: 3, completed: 2, failed: 1 });
      expect(polled.finishedAt).not.toBeNull();
    });

    it('Job added after the group finished', async () => {
      const group = await service.created();
      service.childJobs.count.mockResolvedValueOnce({ total: 2, completed: 2, failed: 0 });
      await service.poll();
      const finished = await service.group(group.id);

      await service.poll();

      expect(await service.group(group.id)).toEqual(finished);
      expect(service.childJobs.count).toHaveBeenCalledOnce();
    });

    it('job-service down during a poll', async () => {
      const group = await service.seed({ status: 'running', total: 4, completed: 1, failed: 1 });
      service.childJobs.count.mockRejectedValueOnce(UNAVAILABLE);

      const result = await service.poll();

      expect(result).toEqual({ checked: 0, failedChecks: 1 });
      expect(await service.group(group.id)).toEqual(group);
    });

    it('job-service back', async () => {
      const group = await service.seed({ status: 'running', total: 4, completed: 1, failed: 1 });
      const backAt = new Date(Date.parse(group.updatedAt) + 60_000);
      service.childJobs.count
        .mockRejectedValueOnce(UNAVAILABLE)
        .mockResolvedValueOnce({ total: 4, completed: 2, failed: 1 });
      vi.spyOn(service.app.get<Clock>(CLOCK), 'now').mockReturnValueOnce({ now: backAt });
      expect(await service.poll()).toEqual({ checked: 0, failedChecks: 1 });

      expect(await service.poll()).toEqual({ checked: 1, failedChecks: 0 });

      const polled = await service.group(group.id);
      expect(polled).toMatchObject({ status: 'running', total: 4, completed: 2, failed: 1 });
      expect(polled.checkedAt).toBe(backAt.toISOString());
    });
  });

  describe('docs', () => {
    it('Group routes in the docs', async () => {
      const response = await fetch(service.url('/docs-json'));
      const { paths } = (await response.json()) as OpenApiDocument;

      expect(Object.keys(paths[JOB_GROUPS_ROUTE] ?? {}).sort()).toEqual(['get', 'post']);
      expect(Object.keys(paths[`${JOB_GROUPS_ROUTE}/{id}`] ?? {}).sort()).toEqual([
        'delete',
        'get',
      ]);
      const groups = paths[JOB_GROUPS_ROUTE];
      const group = paths[`${JOB_GROUPS_ROUTE}/{id}`];
      expect(Object.keys(groups?.post?.responses ?? {}).sort()).toEqual(['201']);
      expect(Object.keys(groups?.get?.responses ?? {}).sort()).toEqual(['200', '400']);
      expect(groups?.get?.parameters?.map((p) => `${p.in}:${p.name}`).sort()).toEqual([
        'query:limit',
        'query:offset',
      ]);
      expect(Object.keys(group?.get?.responses ?? {}).sort()).toEqual(['200', '400', '404']);
      expect(group?.get?.parameters?.map((p) => `${p.in}:${p.name}`)).toEqual(['path:id']);
      expect(Object.keys(group?.delete?.responses ?? {}).sort()).toEqual([
        '204',
        '400',
        '404',
        '409',
        '503',
      ]);
      expect(group?.delete?.parameters?.map((p) => `${p.in}:${p.name}`)).toEqual(['path:id']);
    });
  });
});
