import type { Clock } from '@job-queue/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { CountJobCountsResponse, JobCounts } from '../../domain/jobs/job-counts.js';
import { JobStatisticsImpl } from './job-statistics.impl.js';

const NOW = '2026-10-30T12:00:00.000Z';
const PARAMS = { recentWindowMinutes: 1440, throughputWindowMinutes: 5 };
const ZERO_COUNTS: CountJobCountsResponse = {
  pending: 0,
  processing: 0,
  scheduled: 0,
  recentCompleted: 0,
  recentFailed: 0,
  throughputCompleted: 0,
};

describe('JobStatisticsImpl', () => {
  let counts: DeepMockProxy<JobCounts>;
  let clock: DeepMockProxy<Clock>;
  let statistics: JobStatisticsImpl;

  beforeEach(() => {
    counts = mockDeep<JobCounts>();
    clock = mockDeep<Clock>();
    clock.now.mockReturnValueOnce({ now: new Date(NOW) });
    statistics = new JobStatisticsImpl({ counts, clock }, PARAMS);
  });

  it('counts from the start of each configured window, measured back from now', async () => {
    counts.count.mockResolvedValueOnce(ZERO_COUNTS);

    await statistics.get();

    expect(counts.count).toHaveBeenCalledExactlyOnceWith({
      recentSince: '2026-10-29T12:00:00.000Z',
      throughputSince: '2026-10-30T11:55:00.000Z',
    });
  });

  it('reports the counts and the length of both windows', async () => {
    counts.count.mockResolvedValueOnce({
      pending: 4,
      processing: 2,
      scheduled: 1,
      recentCompleted: 30,
      recentFailed: 3,
      throughputCompleted: 0,
    });

    const { stats } = await statistics.get();

    expect(stats).toEqual({
      pending: 4,
      processing: 2,
      scheduled: 1,
      recent: { windowMinutes: 1440, completed: 30, failed: 3 },
      throughput: { windowMinutes: 5, perMinute: 0 },
    });
  });

  it('Throughput over the window: completed jobs in the window divided by its minutes', async () => {
    counts.count.mockResolvedValueOnce({ ...ZERO_COUNTS, throughputCompleted: 12 });

    const { stats } = await statistics.get();

    expect(stats.throughput).toEqual({ windowMinutes: 5, perMinute: 2.4 });
  });

  it('reports the throughput unrounded', async () => {
    const thirds = new JobStatisticsImpl(
      { counts, clock },
      { recentWindowMinutes: 1440, throughputWindowMinutes: 3 },
    );
    clock.now.mockReturnValueOnce({ now: new Date(NOW) });
    counts.count.mockResolvedValueOnce({ ...ZERO_COUNTS, throughputCompleted: 1 });

    const { stats } = await thirds.get();

    expect(stats.throughput.perMinute).toBe(1 / 3);
  });

  it('lets a failure to read the counts through', async () => {
    const failure = new Error('database unreachable');
    counts.count.mockRejectedValueOnce(failure);

    await expect(statistics.get()).rejects.toBe(failure);
  });
});
