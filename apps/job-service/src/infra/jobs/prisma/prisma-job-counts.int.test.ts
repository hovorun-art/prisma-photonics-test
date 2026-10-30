import { fileURLToPath } from 'node:url';

import type { JobStatus } from '@job-queue/contracts';
import { CONTAINER_IMAGES, PrismaMigrateDeploy } from '@job-queue/test-support';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CountJobCountsRequest } from '../../../domain/jobs/job-counts.js';
import { PrismaDatabase } from '../../prisma/prisma-database.js';
import type { JobType as JobRowType } from '../../prisma/generated/client.js';
import { PrismaJobCounts } from './prisma-job-counts.js';

const APP_DIR = fileURLToPath(new URL('../../../..', import.meta.url));

/** The windows every test counts in: a day back and five minutes back from 12:00. */
const WINDOWS: CountJobCountsRequest = {
  recentSince: '2026-10-29T12:00:00.000Z',
  throughputSince: '2026-10-30T11:55:00.000Z',
};
const INSIDE_THROUGHPUT = '2026-10-30T11:58:00.000Z';
const INSIDE_RECENT_ONLY = '2026-10-30T08:00:00.000Z';
const BEFORE_RECENT = '2026-10-29T11:59:59.999Z';

const ZERO = {
  pending: 0,
  processing: 0,
  scheduled: 0,
  recentCompleted: 0,
  recentFailed: 0,
  throughputCompleted: 0,
};

describe('PrismaJobCounts against Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let database: PrismaDatabase;
  let counts: PrismaJobCounts;

  /** Stores a job in the given status, finished at `completedAt` when given. */
  const store = async (req: {
    status: JobStatus;
    completedAt?: string;
    type?: JobRowType;
  }): Promise<void> => {
    await database.job.create({
      data: {
        type: req.type ?? 'email',
        payload: { to: 'ada@example.com', subject: 'Counted', body: 'Hi' },
        status: req.status,
        priority: 5,
        attempts: 1,
        maxAttempts: 3,
        completedAt: req.completedAt === undefined ? null : new Date(req.completedAt),
      },
    });
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer(CONTAINER_IMAGES.postgres).start();
    await new PrismaMigrateDeploy({ appDir: APP_DIR }).migrate({
      databaseUrl: container.getConnectionUri(),
    });
    database = new PrismaDatabase({ databaseUrl: container.getConnectionUri() });
    counts = new PrismaJobCounts({ prisma: database });
  }, 120_000);
  afterAll(async () => {
    await database.close();
    await container.stop();
  });
  beforeEach(async () => {
    await database.job.deleteMany();
  });

  it('counts nothing in an empty table', async () => {
    expect(await counts.count(WINDOWS)).toEqual(ZERO);
  });

  it('Current counts by status', async () => {
    await store({ status: 'pending' });
    await store({ status: 'pending', type: 'webhook' });
    await store({ status: 'processing' });
    await store({ status: 'scheduled' });
    await store({ status: 'scheduled', type: 'flight_transit' });
    await store({ status: 'scheduled' });
    await store({ status: 'completed', completedAt: BEFORE_RECENT });
    await store({ status: 'failed', completedAt: BEFORE_RECENT });
    await store({ status: 'cancelled' });

    expect(await counts.count(WINDOWS)).toEqual({
      ...ZERO,
      pending: 2,
      processing: 1,
      scheduled: 3,
    });
  });

  it('Completed and failed within the window', async () => {
    await store({ status: 'completed', completedAt: INSIDE_RECENT_ONLY });
    await store({ status: 'failed', completedAt: INSIDE_RECENT_ONLY });

    expect(await counts.count(WINDOWS)).toEqual({ ...ZERO, recentCompleted: 1, recentFailed: 1 });
  });

  it('Jobs finished before the window', async () => {
    await store({ status: 'completed', completedAt: BEFORE_RECENT });
    await store({ status: 'failed', completedAt: BEFORE_RECENT });

    expect(await counts.count(WINDOWS)).toEqual(ZERO);
  });

  it('counts a job that finished exactly at the start of a window', async () => {
    await store({ status: 'failed', completedAt: WINDOWS.recentSince });
    await store({ status: 'completed', completedAt: WINDOWS.throughputSince });

    expect(await counts.count(WINDOWS)).toEqual({
      ...ZERO,
      recentCompleted: 1,
      recentFailed: 1,
      throughputCompleted: 1,
    });
  });

  it('Throughput over the window: counts completed jobs inside the throughput window', async () => {
    await store({ status: 'completed', completedAt: INSIDE_THROUGHPUT });
    await store({ status: 'completed', completedAt: INSIDE_THROUGHPUT });

    expect(await counts.count(WINDOWS)).toEqual({
      ...ZERO,
      recentCompleted: 2,
      throughputCompleted: 2,
    });
  });

  it('Only completed jobs count towards throughput', async () => {
    await store({ status: 'failed', completedAt: INSIDE_THROUGHPUT });

    expect(await counts.count(WINDOWS)).toEqual({ ...ZERO, recentFailed: 1 });
  });

  it('Completions before the throughput window', async () => {
    await store({ status: 'completed', completedAt: INSIDE_RECENT_ONLY });

    expect(await counts.count(WINDOWS)).toEqual({ ...ZERO, recentCompleted: 1 });
  });

  it('counts in both windows when the throughput window starts before the recent one', async () => {
    const windows = {
      recentSince: '2026-10-30T11:55:00.000Z',
      throughputSince: '2026-10-30T11:00:00.000Z',
    };
    await store({ status: 'completed', completedAt: '2026-10-30T11:30:00.000Z' });

    expect(await counts.count(windows)).toEqual({ ...ZERO, throughputCompleted: 1 });
  });

  it('does not count a cancelled job inside a window as completed or failed', async () => {
    await store({ status: 'cancelled', completedAt: INSIDE_THROUGHPUT });

    expect(await counts.count(WINDOWS)).toEqual(ZERO);
  });
});
