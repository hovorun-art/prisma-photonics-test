import { JOBS_ROUTE, QueryJobsResponse } from '@job-queue/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { JOB_COUNTS, type JobCounts } from '../../src/domain/jobs/job-counts.js';
import { JobServiceUnderTest, TEST_CONFIG } from './job-service-under-test.js';

const RECENT_WINDOW_MINUTES = TEST_CONFIG.statsRecentWindowMinutes;
const THROUGHPUT_WINDOW_MINUTES = TEST_CONFIG.statsThroughputWindowMinutes;
const ERROR = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };
const NO_STATUS_COUNTS = {
  scheduled: 0,
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
};
const NO_TYPE_COUNTS = { email: 0, webhook: 0, 'flight-transit': 0 };

describe('job-service queue statistics', () => {
  let service: JobServiceUnderTest;

  beforeAll(async () => {
    service = await JobServiceUnderTest.start();
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

  it('Statistics of an empty queue', async () => {
    expect(await service.stats()).toEqual({
      pending: 0,
      processing: 0,
      scheduled: 0,
      recent: { windowMinutes: RECENT_WINDOW_MINUTES, completed: 0, failed: 0 },
      throughput: { windowMinutes: THROUGHPUT_WINDOW_MINUTES, perMinute: 0 },
      counts: { status: NO_STATUS_COUNTS, type: NO_TYPE_COUNTS },
    });
  });

  it('Statistics without a service token', async () => {
    const response = await service.statsResponse();

    expect(response.status).toBe(200);
  });

  it('Jobs of every type are counted', async () => {
    service.queue.enqueue.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await service.submitted({
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
    });
    await service.submitted({
      type: 'webhook',
      payload: { method: 'POST', url: 'https://hooks.example.com/orders' },
    });

    expect((await service.stats()).pending).toBe(2);
  });

  it('Current counts by status', async () => {
    await service.seed({ status: 'pending' });
    await service.seed({ status: 'processing', type: 'flight-transit' });
    await service.seed({ status: 'processing' });
    await service.seed({ status: 'scheduled' });
    await service.seed({ status: 'scheduled' });
    await service.seed({ status: 'scheduled', type: 'webhook' });
    await service.seed({ status: 'completed' });
    await service.seed({ status: 'failed' });
    await service.seed({ status: 'cancelled' });

    const { pending, processing, scheduled } = await service.stats();

    expect({ pending, processing, scheduled }).toEqual({ pending: 1, processing: 2, scheduled: 3 });
  });

  it('Failed attempt that will be retried', async () => {
    const job = await service.seed({ status: 'processing', attempts: 1, maxAttempts: 3 });
    service.queue.enqueue.mockResolvedValueOnce({});
    const report = await service.report({
      id: job.id,
      body: { status: 'failed', run: 1, attempt: 1, error: ERROR },
    });
    expect(report.status).toBe(200);

    const stats = await service.stats();

    expect(stats.scheduled).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.processing).toBe(0);
    expect(stats.recent.failed).toBe(0);
  });

  it('Completed and failed within the window', async () => {
    await service.seed({ status: 'completed' });
    await service.seed({ status: 'failed', type: 'webhook' });

    expect((await service.stats()).recent).toEqual({
      windowMinutes: RECENT_WINDOW_MINUTES,
      completed: 1,
      failed: 1,
    });
  });

  it('Throughput over the window', async () => {
    await service.seed({ status: 'completed' });
    await service.seed({ status: 'completed', type: 'webhook' });
    await service.seed({ status: 'failed' });

    expect((await service.stats()).throughput).toEqual({
      windowMinutes: THROUGHPUT_WINDOW_MINUTES,
      perMinute: 2 / THROUGHPUT_WINDOW_MINUTES,
    });
  });

  it('Database unavailable', async () => {
    vi.spyOn(service.app.get<JobCounts>(JOB_COUNTS), 'count').mockRejectedValueOnce(
      new Error('connection refused'),
    );

    await service.errorBody({
      response: await service.statsResponse(),
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  describe('job counts per status and per type', () => {
    /** Two failed webhook jobs, one failed email job and one completed webhook job. */
    const seedMixed = async (): Promise<void> => {
      await service.seed({ status: 'failed', type: 'webhook' });
      await service.seed({ status: 'failed', type: 'webhook' });
      await service.seed({ status: 'failed' });
      await service.seed({ status: 'completed', type: 'webhook' });
    };

    it('Counts without filters', async () => {
      await service.seed({ status: 'failed', type: 'webhook' });
      await service.seed({ status: 'failed', type: 'webhook' });
      await service.seed({ status: 'completed' });
      await service.seed({ status: 'pending' });

      expect((await service.stats()).counts).toEqual({
        status: { ...NO_STATUS_COUNTS, failed: 2, completed: 1, pending: 1 },
        type: { ...NO_TYPE_COUNTS, webhook: 2, email: 2 },
      });
    });

    it('Old finished jobs are counted', async () => {
      const beforeWindow = new Date(
        Date.now() - (RECENT_WINDOW_MINUTES + 1) * 60_000,
      ).toISOString();
      await service.seed({ status: 'completed', completedAt: beforeWindow });

      const stats = await service.stats();

      expect(stats.counts.status.completed).toBe(1);
      expect(stats.recent.completed).toBe(0);
    });

    it('Status counts under a type filter', async () => {
      await seedMixed();

      expect((await service.stats([['type', 'webhook']])).counts).toEqual({
        status: { ...NO_STATUS_COUNTS, failed: 2, completed: 1 },
        type: { ...NO_TYPE_COUNTS, webhook: 3, email: 1 },
      });
    });

    it('Type counts under a status filter', async () => {
      await seedMixed();

      expect((await service.stats([['status', 'failed']])).counts).toEqual({
        status: { ...NO_STATUS_COUNTS, failed: 3, completed: 1 },
        type: { ...NO_TYPE_COUNTS, webhook: 2, email: 1 },
      });
    });

    it('Both filters', async () => {
      await seedMixed();

      const params: [string, string][] = [
        ['status', 'failed'],
        ['type', 'webhook'],
      ];

      expect((await service.stats(params)).counts).toEqual({
        status: { ...NO_STATUS_COUNTS, failed: 2, completed: 1 },
        type: { ...NO_TYPE_COUNTS, webhook: 2, email: 1 },
      });
    });

    it('Count matches the filtered list total', async () => {
      await seedMixed();

      const stats = await service.stats([['type', 'webhook']]);
      const list = QueryJobsResponse.parse(
        await (await fetch(service.url(`${JOBS_ROUTE}?type=webhook&status=failed`))).json(),
      );

      expect(list.total).toBe(2);
      expect(stats.counts.status.failed).toBe(list.total);
    });

    it('Filters leave the other statistics unchanged', async () => {
      await service.seed({ status: 'pending' });
      await service.seed({ status: 'pending', type: 'webhook' });
      await service.seed({ status: 'completed', type: 'webhook' });

      const { counts: _unfilteredCounts, ...unfiltered } = await service.stats();
      const { counts: _filteredCounts, ...filtered } = await service.stats([
        ['type', 'webhook'],
        ['status', 'failed'],
      ]);

      expect(filtered).toEqual(unfiltered);
      expect(filtered.pending).toBe(2);
    });
  });

  describe('invalid filters', () => {
    const rejectedFields = async (params: [string, string][]): Promise<unknown[]> =>
      (await service.issuePaths(await service.statsResponse(params))).map(
        (path) => (path as unknown[])[0],
      );

    it('Unknown status filter on statistics', async () => {
      expect(await rejectedFields([['status', 'archived']])).toEqual(['status']);
    });

    it('Unknown type filter on statistics', async () => {
      expect(await rejectedFields([['type', 'batch']])).toEqual(['type']);
    });

    it('Empty filter value on statistics', async () => {
      expect(await rejectedFields([['type', '']])).toEqual(['type']);
    });

    it('Filter given twice on statistics', async () => {
      expect(
        await rejectedFields([
          ['status', 'failed'],
          ['status', 'cancelled'],
        ]),
      ).toEqual(['status']);
    });
  });
});
