import { randomUUID } from 'node:crypto';

import { fileURLToPath } from 'node:url';

import {
  FINISHED_JOB_STATUSES,
  type FlightTransitJobPayload,
  type Job,
  type WebhookJobPayload,
} from '@job-queue/contracts';
import { CONTAINER_IMAGES, PrismaMigrateDeploy } from '@job-queue/test-support';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobNotFoundError, JobStatusConflictError } from '@job-queue/kernel';
import type { NewJob } from '../../../domain/jobs/job-repository.js';
import { PrismaDatabase } from '../../prisma/prisma-database.js';
import { PrismaJobRepository } from './prisma-job-repository.js';

const APP_DIR = fileURLToPath(new URL('../../../..', import.meta.url));
type NewEmailJob = Extract<NewJob, { type: 'email' }>;

const UNKNOWN_ID = randomUUID();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('PrismaJobRepository against Postgres', () => {
  let container: StartedPostgreSqlContainer;
  let database: PrismaDatabase;
  let repository: PrismaJobRepository;
  let sequence = 0;

  /** A complete pending email job, as `JobService` hands it to the repository. */
  const newJob = (overrides: Partial<NewEmailJob> = {}): NewEmailJob => {
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
  const store = async (overrides: Partial<NewEmailJob> = {}): Promise<Job> =>
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

  it('creates a webhook job, with and without a body, and gets it back unchanged', async () => {
    const webhookJob = (payload: WebhookJobPayload): NewJob => ({
      ...newJob(),
      type: 'webhook',
      payload,
      result: null,
    });
    const payloads: WebhookJobPayload[] = [
      { method: 'POST', url: 'https://hooks.example.com/orders', body: { orderId: 'ord_4821' } },
      { method: 'GET', url: 'http://example.com/ping' },
    ];

    for (const payload of payloads) {
      const { job: stored } = await repository.create({ job: webhookJob(payload) });

      expect(stored).toMatchObject({ type: 'webhook', payload });
      expect((await repository.get({ id: stored.id })).job).toEqual(stored);
    }
  });

  it('creates a flight transit job, gets it back unchanged and lists it next to an email job', async () => {
    const email = await store();
    const payload: FlightTransitJobPayload = {
      origin: 'LHR',
      destination: 'JFK',
      departureDate: '2030-06-15',
    };

    const { job: transit } = await repository.create({
      job: { ...newJob(), type: 'flight-transit', payload, result: null },
    });

    expect(transit).toMatchObject({ type: 'flight-transit', payload });
    expect((await repository.get({ id: transit.id })).job).toEqual(transit);
    const page = await repository.query({ limit: 10, offset: 0 });
    expect(page.items.map((job) => job.type).sort()).toEqual(['email', 'flight-transit']);
    expect(page.items).toContainEqual(transit);
    expect(page.items).toContainEqual(email);
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

  describe('filters', () => {
    type Kind = Pick<Job, 'status' | 'type'>;
    const PAYLOADS = {
      email: { to: 'ada@example.com', subject: 'Filtered', body: 'Hi' },
      webhook: { method: 'GET', url: 'http://example.com/ping' },
      'flight-transit': { origin: 'LHR', destination: 'JFK', departureDate: '2030-06-15' },
    } as const;

    /** Stores one job per kind, one second apart in the given order, so newest first is the reverse. */
    const storeKinds = async (kinds: Kind[]): Promise<Job[]> => {
      const jobs: Job[] = [];
      for (const [i, kind] of kinds.entries()) {
        const row = await database.job.create({
          data: {
            ...kind,
            type: kind.type === 'flight-transit' ? 'flight_transit' : kind.type,
            payload: PAYLOADS[kind.type],
            priority: 5,
            attempts: 0,
            maxAttempts: 3,
            createdAt: new Date(Date.UTC(2026, 9, 30, 12, 0, i)),
          },
        });
        jobs.push((await repository.get({ id: row.id })).job);
      }
      return jobs;
    };
    const idsNewestFirst = (jobs: Job[]): string[] => jobs.map((job) => job.id).reverse();

    it('Filter by one status', async () => {
      const [failedOld, , failedNew] = await storeKinds([
        { status: 'failed', type: 'email' },
        { status: 'completed', type: 'email' },
        { status: 'failed', type: 'webhook' },
        { status: 'pending', type: 'webhook' },
      ]);

      const page = await repository.query({ limit: 10, offset: 0, statuses: ['failed'] });

      expect(page.items.map((job) => job.id)).toEqual(idsNewestFirst([failedOld!, failedNew!]));
      expect(page.total).toBe(2);
    });

    it('Filter by several statuses', async () => {
      const [failed, , cancelled] = await storeKinds([
        { status: 'failed', type: 'email' },
        { status: 'completed', type: 'email' },
        { status: 'cancelled', type: 'webhook' },
        { status: 'pending', type: 'webhook' },
      ]);

      const page = await repository.query({
        limit: 10,
        offset: 0,
        statuses: ['failed', 'cancelled'],
      });

      expect(page.items.map((job) => job.id)).toEqual(idsNewestFirst([failed!, cancelled!]));
      expect(page.total).toBe(2);
    });

    it('Filter by one type', async () => {
      const [, webhook] = await storeKinds([
        { status: 'pending', type: 'email' },
        { status: 'pending', type: 'webhook' },
        { status: 'pending', type: 'flight-transit' },
      ]);

      const page = await repository.query({ limit: 10, offset: 0, types: ['webhook'] });

      expect(page.items.map((job) => job.id)).toEqual([webhook!.id]);
      expect(page.total).toBe(1);
    });

    it('Filter by several types', async () => {
      const [email, , transit] = await storeKinds([
        { status: 'pending', type: 'email' },
        { status: 'pending', type: 'webhook' },
        { status: 'pending', type: 'flight-transit' },
      ]);

      const page = await repository.query({
        limit: 10,
        offset: 0,
        types: ['email', 'flight-transit'],
      });

      expect(page.items.map((job) => job.id)).toEqual(idsNewestFirst([email!, transit!]));
      expect(page.total).toBe(2);
    });

    it('Status and type together', async () => {
      const [, failedWebhook] = await storeKinds([
        { status: 'failed', type: 'email' },
        { status: 'failed', type: 'webhook' },
        { status: 'completed', type: 'webhook' },
      ]);

      const page = await repository.query({
        limit: 10,
        offset: 0,
        statuses: ['failed'],
        types: ['webhook'],
      });

      expect(page.items.map((job) => job.id)).toEqual([failedWebhook!.id]);
      expect(page.total).toBe(1);
    });

    it('Paging through filtered jobs', async () => {
      const jobs = await storeKinds([
        { status: 'failed', type: 'email' },
        { status: 'completed', type: 'email' },
        { status: 'failed', type: 'email' },
        { status: 'failed', type: 'webhook' },
        { status: 'pending', type: 'email' },
        { status: 'failed', type: 'email' },
      ]);
      const failedNewestFirst = jobs.filter((job) => job.status === 'failed').reverse();

      const page = await repository.query({ limit: 2, offset: 1, statuses: ['failed'] });

      expect(page.items.map((job) => job.id)).toEqual([
        failedNewestFirst[1]!.id,
        failedNewestFirst[2]!.id,
      ]);
      expect(page.total).toBe(4);
    });

    it('returns jobs of every status and type without a filter', async () => {
      const jobs = await storeKinds([
        { status: 'pending', type: 'email' },
        { status: 'failed', type: 'webhook' },
        { status: 'completed', type: 'flight-transit' },
        { status: 'cancelled', type: 'email' },
      ]);

      const page = await repository.query({ limit: 10, offset: 0 });

      expect(page.items.map((job) => job.id)).toEqual(idsNewestFirst(jobs));
      expect(page.total).toBe(4);
    });

    it('counts the filtered jobs even when the offset is past them', async () => {
      await storeKinds([
        { status: 'failed', type: 'email' },
        { status: 'completed', type: 'email' },
        { status: 'failed', type: 'webhook' },
      ]);

      const page = await repository.query({ limit: 10, offset: 2, statuses: ['failed'] });

      expect(page).toEqual({ items: [], total: 2 });
    });

    it('No job matches the status', async () => {
      await storeKinds([{ status: 'pending', type: 'email' }]);

      const page = await repository.query({ limit: 10, offset: 0, statuses: ['cancelled'] });

      expect(page).toEqual({ items: [], total: 0 });
    });
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
