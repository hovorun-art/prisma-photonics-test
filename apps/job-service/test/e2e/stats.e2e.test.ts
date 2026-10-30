import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { JOB_COUNTS, type JobCounts } from '../../src/domain/jobs/job-counts.js';
import { JobServiceUnderTest, TEST_CONFIG } from './job-service-under-test.js';

const RECENT_WINDOW_MINUTES = TEST_CONFIG.statsRecentWindowMinutes;
const THROUGHPUT_WINDOW_MINUTES = TEST_CONFIG.statsThroughputWindowMinutes;
const ERROR = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };

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
    const report = await service.report({ id: job.id, body: { status: 'failed', error: ERROR } });
    expect(report.status).toBe(200);

    const stats = await service.stats();

    expect(stats.pending).toBe(1);
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
});
