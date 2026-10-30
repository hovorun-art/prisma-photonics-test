import { randomUUID } from 'node:crypto';

import { fileURLToPath } from 'node:url';

import { FINISHED_JOB_STATUSES, type Job } from '@job-queue/contracts';
import { CONTAINER_IMAGES, PrismaMigrateDeploy } from '@job-queue/test-support';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type { NewJob } from '../../../domain/jobs/job-repository.js';
import { PrismaDatabase } from '../../prisma/prisma-database.js';
import { PrismaJobRepository } from './prisma-job-repository.js';

const APP_DIR = fileURLToPath(new URL('../../../..', import.meta.url));
const UNKNOWN_ID = randomUUID();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('PrismaJobRepository against Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let database: PrismaDatabase;
  let repository: PrismaJobRepository;
  let sequence = 0;

  /** A complete pending email job, as `JobService` hands it to the repository. */
  const newJob = (overrides: Partial<NewJob> = {}): NewJob => {
    sequence += 1;
    return {
      type: 'email',
      payload: { to: 'ada@example.com', subject: `Job ${sequence}`, body: 'Hi' },
      status: 'pending',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      result: null,
      error: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      ...overrides,
    };
  };

  /** Stores a job created at the given time (normally the database's clock), for order tests. */
  const storeCreatedAt = async (createdAt: string): Promise<Job> => {
    const row = await database.job.create({
      data: {
        type: 'email',
        payload: { to: 'ada@example.com', subject: 'Ordered', body: 'Hi' },
        status: 'pending',
        priority: 5,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(createdAt),
      },
    });
    return (await repository.get({ id: row.id })).job;
  };

  /** Stores a new job and returns it with the id and timestamps the database assigned. */
  const store = async (overrides: Partial<NewJob> = {}): Promise<Job> =>
    (await repository.create({ job: newJob(overrides) })).job;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(CONTAINER_IMAGES.postgres).start();
    await new PrismaMigrateDeploy({ appDir: APP_DIR }).migrate({
      databaseUrl: container.getConnectionUri(),
    });
    database = new PrismaDatabase({ databaseUrl: container.getConnectionUri() });
    repository = new PrismaJobRepository({ prisma: database });
  }, 120_000);
  afterAll(async () => {
    await database.close();
    await container.stop();
  });
  beforeEach(async () => {
    await database.job.deleteMany();
  });

  it('creates a job with a database-assigned UUID and gets it back unchanged', async () => {
    const job = newJob();

    const { job: stored } = await repository.create({ job });

    expect(stored.id).toMatch(UUID);
    expect(stored).toEqual({
      ...job,
      id: stored.id,
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
    });
    expect((await repository.get({ id: stored.id })).job).toEqual(stored);
  });

  it('throws JobNotFoundError when getting an unknown id', async () => {
    await expect(repository.get({ id: UNKNOWN_ID })).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it('queries newest first with limit, offset and the total', async () => {
    const jobs: Job[] = [];
    for (let i = 0; i < 5; i += 1) {
      jobs.push(await storeCreatedAt(new Date(Date.UTC(2026, 9, 29, 12, 0, i)).toISOString()));
    }

    const page = await repository.query({ limit: 2, offset: 1 });

    expect(page.items.map((job) => job.id)).toEqual([jobs[3]!.id, jobs[2]!.id]);
    expect(page.total).toBe(5);
  });

  it('breaks ties in creation time by id', async () => {
    const createdAt = '2026-10-29T12:00:00.000Z';
    const jobs: Job[] = [];
    for (let i = 0; i < 3; i += 1) jobs.push(await storeCreatedAt(createdAt));

    const page = await repository.query({ limit: 3, offset: 0 });

    expect(page.items.map((job) => job.id)).toEqual(
      jobs
        .map((job) => job.id)
        .sort()
        .reverse(),
    );
  });

  it('applies the changes when the expected status and attempts match', async () => {
    const job = await store();

    const { job: updated } = await repository.update({
      id: job.id,
      expected: { status: 'pending', attempts: 0 },
      changes: {
        status: 'processing',
        attempts: 1,
        startedAt: '2026-10-29T13:00:00.000Z',
      },
    });

    expect(updated).toEqual({
      ...job,
      status: 'processing',
      attempts: 1,
      startedAt: '2026-10-29T13:00:00.000Z',
      updatedAt: updated.updatedAt,
    });
    expect(updated.updatedAt >= job.updatedAt).toBe(true);
  });

  it('stores a result and an error and can clear them', async () => {
    const job = await store({ status: 'processing', attempts: 1 });

    const failed = await repository.update({
      id: job.id,
      expected: { status: 'processing', attempts: 1 },
      changes: {
        status: 'pending',
        error: { code: 'SEND_FAILED', message: 'Mailbox unavailable' },
      },
    });
    expect(failed.job.error).toEqual({ code: 'SEND_FAILED', message: 'Mailbox unavailable' });

    const completed = await repository.update({
      id: job.id,
      expected: { status: 'pending', attempts: 1 },
      changes: {
        status: 'completed',
        result: { messageId: 'm-1' },
        error: null,
        completedAt: '2026-10-29T13:01:00.000Z',
      },
    });
    expect(completed.job).toMatchObject({
      status: 'completed',
      result: { messageId: 'm-1' },
      error: null,
      completedAt: '2026-10-29T13:01:00.000Z',
    });
  });

  it('refuses an update from a stale state with the current status', async () => {
    const job = await store({ status: 'processing', attempts: 2 });

    for (const expected of [
      { status: 'pending' as const, attempts: 2 },
      { status: 'processing' as const, attempts: 1 },
    ]) {
      const update = repository.update({
        id: job.id,
        expected,
        changes: { status: 'completed' },
      });

      await expect(update).rejects.toBeInstanceOf(JobStatusConflictError);
      await expect(update).rejects.toMatchObject({ details: { status: 'processing' } });
    }
    expect((await repository.get({ id: job.id })).job).toEqual(job);
  });

  it('throws JobNotFoundError when updating an unknown id', async () => {
    await expect(
      repository.update({
        id: UNKNOWN_ID,
        expected: { status: 'pending', attempts: 0 },
        changes: { status: 'processing' },
      }),
    ).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it('lets exactly one of two concurrent updates from the same state win', async () => {
    const job = await store();
    const start = (): ReturnType<PrismaJobRepository['update']> =>
      repository.update({
        id: job.id,
        expected: { status: 'pending', attempts: 0 },
        changes: { status: 'processing', attempts: 1 },
      });

    const outcomes = await Promise.allSettled([start(), start()]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(JobStatusConflictError);
    expect((await repository.get({ id: job.id })).job.attempts).toBe(1);
  });

  it('deletes a job whose status is allowed', async () => {
    const finished = FINISHED_JOB_STATUSES;
    for (const status of finished) {
      const job = await store({ status });

      await expect(repository.delete({ id: job.id, allowedStatuses: finished })).resolves.toEqual(
        {},
      );
      await expect(repository.get({ id: job.id })).rejects.toBeInstanceOf(JobNotFoundError);
    }
  });

  it('keeps a job whose status is not allowed and reports its status', async () => {
    const job = await store({ status: 'processing', attempts: 1 });

    const deletion = repository.delete({ id: job.id, allowedStatuses: ['completed'] });

    await expect(deletion).rejects.toBeInstanceOf(JobStatusConflictError);
    await expect(deletion).rejects.toMatchObject({ details: { status: 'processing' } });
    expect((await repository.get({ id: job.id })).job).toEqual(job);
  });

  it('throws JobNotFoundError when deleting an unknown id', async () => {
    await expect(
      repository.delete({ id: UNKNOWN_ID, allowedStatuses: ['completed'] }),
    ).rejects.toBeInstanceOf(JobNotFoundError);
  });
});
