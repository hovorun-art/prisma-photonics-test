import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { JobGroup } from '@job-queue/contracts';
import { CONTAINER_IMAGES, PrismaMigrateDeploy } from '@job-queue/test-support';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { RecordCheckJobGroupRepositoryRequest } from '../../../domain/groups/job-group-repository.js';
import { PrismaDatabase } from '../../prisma/prisma-database.js';
import { PrismaJobGroupRepository } from './prisma-job-group-repository.js';

const APP_DIR = fileURLToPath(new URL('../../../..', import.meta.url));
// Not the production name, so SQL with a hardcoded schema fails here.
const SCHEMA = 'groups_it';
const UNKNOWN_ID = randomUUID();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHECKED_AT = '2026-10-30T12:00:00.000Z';
const FINISHED_AT = '2026-10-30T12:00:01.000Z';

describe('PrismaJobGroupRepository against Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let database: PrismaDatabase;
  let repository: PrismaJobGroupRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(CONTAINER_IMAGES.postgres).start();
    await new PrismaMigrateDeploy({ appDir: APP_DIR }).migrate({
      databaseUrl: `${container.getConnectionUri()}?schema=${SCHEMA}`,
    });
    database = new PrismaDatabase({
      databaseUrl: container.getConnectionUri(),
      databaseSchema: SCHEMA,
    });
    repository = new PrismaJobGroupRepository({ prisma: database }, { schema: SCHEMA });
  }, 180_000);
  afterAll(async () => {
    await database.close();
    await container.stop();
  });
  beforeEach(async () => {
    await database.jobGroup.deleteMany();
  });

  const check = (
    id: string,
    overrides: Partial<RecordCheckJobGroupRepositoryRequest> = {},
  ): RecordCheckJobGroupRepositoryRequest => ({
    id,
    status: 'running',
    total: 3,
    completed: 1,
    failed: 0,
    checkedAt: CHECKED_AT,
    finishedAt: null,
    ...overrides,
  });

  /** Inserts a running group with a fixed creation time, for ordering tests. */
  async function seed(createdAt: string, id: string = randomUUID()): Promise<JobGroup> {
    await database.jobGroup.create({
      data: { id, status: 'running', total: 0, completed: 0, failed: 0, createdAt },
    });
    return (await repository.get({ id })).group!;
  }

  const byIdAscending = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  describe('create', () => {
    it('stores a running group with zero stats and no checks yet', async () => {
      const { group } = await repository.create();

      expect(group.id).toMatch(UUID);
      expect(group).toEqual({
        id: group.id,
        status: 'running',
        total: 0,
        completed: 0,
        failed: 0,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        checkedAt: null,
        finishedAt: null,
      });
      expect(group.createdAt).toMatch(/Z$/);
      expect(group.updatedAt).toMatch(/Z$/);
      expect(await database.jobGroup.count()).toBe(1);
    });

    it('gives each group its own id', async () => {
      const first = await repository.create();
      const second = await repository.create();

      expect(first.group.id).not.toBe(second.group.id);
    });
  });

  describe('get', () => {
    it('returns the stored group', async () => {
      const { group } = await repository.create();

      await expect(repository.get({ id: group.id })).resolves.toEqual({ group });
    });

    it('returns null for an unknown id', async () => {
      await expect(repository.get({ id: UNKNOWN_ID })).resolves.toEqual({ group: null });
    });
  });

  describe('query', () => {
    it('returns the page newest first and the count of all groups', async () => {
      const oldest = await seed('2026-10-01T00:00:00.000Z');
      const middle = await seed('2026-10-02T00:00:00.000Z');
      const newest = await seed('2026-10-03T00:00:00.000Z');

      await expect(repository.query({ limit: 2, offset: 0 })).resolves.toEqual({
        items: [newest, middle],
        total: 3,
      });
      await expect(repository.query({ limit: 2, offset: 2 })).resolves.toEqual({
        items: [oldest],
        total: 3,
      });
    });

    it('keeps a stable order, id descending, for groups with the same creation time', async () => {
      const at = '2026-10-01T00:00:00.000Z';
      // Inserted in ascending id order, so insertion order is never the expected order.
      const ids = Array.from({ length: 8 }, () => randomUUID()).sort(byIdAscending);
      for (const id of ids) await seed(at, id);
      const expected = [...ids].reverse();

      const first = await repository.query({ limit: 4, offset: 0 });
      const second = await repository.query({ limit: 4, offset: 4 });

      expect([...first.items, ...second.items].map((group) => group.id)).toEqual(expected);
    });

    it('includes finished groups in the items and the total', async () => {
      const running = await seed('2026-10-01T00:00:00.000Z');
      const completed = await seed('2026-10-02T00:00:00.000Z');
      const failed = await seed('2026-10-03T00:00:00.000Z');
      await repository.recordCheck(
        check(completed.id, { status: 'completed', finishedAt: FINISHED_AT }),
      );
      await repository.recordCheck(check(failed.id, { status: 'failed', finishedAt: FINISHED_AT }));

      const { items, total } = await repository.query({ limit: 10, offset: 0 });

      expect(items.map((group) => [group.id, group.status])).toEqual([
        [failed.id, 'failed'],
        [completed.id, 'completed'],
        [running.id, 'running'],
      ]);
      expect(total).toBe(3);
    });

    it('returns no items and a zero total when there are no groups', async () => {
      await expect(repository.query({ limit: 10, offset: 0 })).resolves.toEqual({
        items: [],
        total: 0,
      });
    });

    it('returns no items but the full total for an offset past the end', async () => {
      await repository.create();

      await expect(repository.query({ limit: 10, offset: 5 })).resolves.toEqual({
        items: [],
        total: 1,
      });
    });
  });

  describe('delete', () => {
    it('removes the group and reports it', async () => {
      const { group } = await repository.create();

      await expect(repository.delete({ id: group.id })).resolves.toEqual({ deleted: true });
      expect(await database.jobGroup.count()).toBe(0);
    });

    it('reports false for an unknown id and leaves other groups', async () => {
      await repository.create();

      await expect(repository.delete({ id: UNKNOWN_ID })).resolves.toEqual({ deleted: false });
      expect(await database.jobGroup.count()).toBe(1);
    });
  });

  describe('listRunning', () => {
    it('returns only running groups, ordered by id', async () => {
      const running = [await seed(CHECKED_AT), await seed(CHECKED_AT), await seed(CHECKED_AT)];
      const completed = await repository.create();
      const failed = await repository.create();
      await repository.recordCheck(
        check(completed.group.id, { status: 'completed', finishedAt: FINISHED_AT }),
      );
      await repository.recordCheck(
        check(failed.group.id, { status: 'failed', finishedAt: FINISHED_AT }),
      );

      const { groups } = await repository.listRunning({ limit: 10 });

      expect(groups.map((group) => group.id)).toEqual(
        running.map((group) => group.id).sort(byIdAscending),
      );
    });

    it('limits the page and continues after the given id', async () => {
      const ids = [await seed(CHECKED_AT), await seed(CHECKED_AT), await seed(CHECKED_AT)]
        .map((group) => group.id)
        .sort(byIdAscending);

      const first = await repository.listRunning({ limit: 2 });
      const second = await repository.listRunning({ limit: 2, afterId: ids[1] });
      const last = await repository.listRunning({ limit: 2, afterId: ids[2] });

      expect(first.groups.map((group) => group.id)).toEqual([ids[0], ids[1]]);
      expect(second.groups.map((group) => group.id)).toEqual([ids[2]]);
      expect(last.groups).toEqual([]);
    });

    it('keeps paging correctly when a group on the read page finishes meanwhile', async () => {
      const ids = [await seed(CHECKED_AT), await seed(CHECKED_AT), await seed(CHECKED_AT)]
        .map((group) => group.id)
        .sort(byIdAscending);
      const first = await repository.listRunning({ limit: 2 });
      await repository.recordCheck(
        check(ids[0]!, { status: 'completed', finishedAt: FINISHED_AT }),
      );

      const second = await repository.listRunning({ limit: 2, afterId: first.groups[1]?.id });

      expect(second.groups.map((group) => group.id)).toEqual([ids[2]]);
    });

    it('returns nothing when there are no groups', async () => {
      await expect(repository.listRunning({ limit: 10 })).resolves.toEqual({ groups: [] });
    });
  });

  describe('recordCheck', () => {
    it('writes the stats, status and times of a poll', async () => {
      const old = '2026-10-01T00:00:00.000Z';
      const { id } = await database.jobGroup.create({
        data: { status: 'running', total: 0, completed: 0, failed: 0, updatedAt: old },
      });

      await expect(repository.recordCheck(check(id))).resolves.toEqual({ recorded: true });

      const stored = (await repository.get({ id })).group;
      expect(stored).toMatchObject({
        status: 'running',
        total: 3,
        completed: 1,
        failed: 0,
        checkedAt: CHECKED_AT,
        finishedAt: null,
      });
      expect(Date.parse(stored?.updatedAt ?? '')).toBeGreaterThan(Date.parse(old));
    });

    it('records the finish of a group', async () => {
      const { group } = await repository.create();

      await repository.recordCheck(
        check(group.id, {
          status: 'failed',
          total: 3,
          completed: 2,
          failed: 1,
          finishedAt: FINISHED_AT,
        }),
      );

      expect((await repository.get({ id: group.id })).group).toMatchObject({
        status: 'failed',
        completed: 2,
        failed: 1,
        finishedAt: FINISHED_AT,
      });
    });

    it('keeps the larger total when the given one is smaller', async () => {
      const { group } = await repository.create();
      await repository.recordCheck(check(group.id, { total: 5, completed: 2 }));

      await repository.recordCheck(check(group.id, { total: 3, completed: 3 }));

      expect((await repository.get({ id: group.id })).group).toMatchObject({
        total: 5,
        completed: 3,
      });
    });

    it('raises the total when the given one is larger', async () => {
      const { group } = await repository.create();
      await repository.recordCheck(check(group.id, { total: 3 }));

      await repository.recordCheck(check(group.id, { total: 4 }));

      expect((await repository.get({ id: group.id })).group?.total).toBe(4);
    });

    it('changes nothing and reports false for a deleted group', async () => {
      const { group } = await repository.create();
      await repository.delete({ id: group.id });

      await expect(repository.recordCheck(check(group.id))).resolves.toEqual({ recorded: false });
      expect(await database.jobGroup.count()).toBe(0);
    });

    it('changes nothing and reports false for a group that already finished', async () => {
      const { group } = await repository.create();
      await repository.recordCheck(
        check(group.id, { status: 'completed', total: 3, completed: 3, finishedAt: FINISHED_AT }),
      );
      const frozen = (await repository.get({ id: group.id })).group;

      await expect(
        repository.recordCheck(check(group.id, { status: 'running', total: 9, completed: 0 })),
      ).resolves.toEqual({ recorded: false });

      expect((await repository.get({ id: group.id })).group).toEqual(frozen);
    });

    it('leaves other groups untouched', async () => {
      const target = await repository.create();
      const other = await repository.create();

      await repository.recordCheck(check(target.group.id));

      expect((await repository.get({ id: other.group.id })).group).toEqual(other.group);
    });
  });
});
