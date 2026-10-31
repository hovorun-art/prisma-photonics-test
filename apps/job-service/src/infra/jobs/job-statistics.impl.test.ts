import type { Clock } from '@job-queue/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type {
  CountByStatusAndTypeJobCountsResponse,
  CountJobCountsResponse,
  JobCounts,
} from '../../domain/jobs/job-counts.js';
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

const NO_STATUS_COUNTS = {
  scheduled: 0,
  pending: 0,
  processing: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
};
const NO_TYPE_COUNTS = { email: 0, webhook: 0, 'flight-transit': 0 };

/** Two failed webhook jobs, one failed email job, one completed webhook and one pending email job. */
const CELLS: CountByStatusAndTypeJobCountsResponse = {
  cells: [
    { status: 'failed', type: 'webhook', count: 2 },
    { status: 'failed', type: 'email', count: 1 },
    { status: 'completed', type: 'webhook', count: 1 },
    { status: 'pending', type: 'email', count: 1 },
  ],
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
    counts.countByStatusAndType.mockResolvedValueOnce({ cells: [] });

    await statistics.get({});

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
    counts.countByStatusAndType.mockResolvedValueOnce({ cells: [] });

    const { stats } = await statistics.get({});

    expect(stats).toEqual({
      pending: 4,
      processing: 2,
      scheduled: 1,
      recent: { windowMinutes: 1440, completed: 30, failed: 3 },
      throughput: { windowMinutes: 5, perMinute: 0 },
      counts: { status: NO_STATUS_COUNTS, type: NO_TYPE_COUNTS },
    });
  });

  it('Throughput over the window: completed jobs in the window divided by its minutes', async () => {
    counts.count.mockResolvedValueOnce({ ...ZERO_COUNTS, throughputCompleted: 12 });
    counts.countByStatusAndType.mockResolvedValueOnce({ cells: [] });

    const { stats } = await statistics.get({});

    expect(stats.throughput).toEqual({ windowMinutes: 5, perMinute: 2.4 });
  });

  it('reports the throughput unrounded', async () => {
    const thirds = new JobStatisticsImpl(
      { counts, clock },
      { recentWindowMinutes: 1440, throughputWindowMinutes: 3 },
    );
    clock.now.mockReturnValueOnce({ now: new Date(NOW) });
    counts.count.mockResolvedValueOnce({ ...ZERO_COUNTS, throughputCompleted: 1 });
    counts.countByStatusAndType.mockResolvedValueOnce({ cells: [] });

    const { stats } = await thirds.get({});

    expect(stats.throughput.perMinute).toBe(1 / 3);
  });

  it('lets a failure to read the counts through', async () => {
    const failure = new Error('database unreachable');
    counts.count.mockRejectedValueOnce(failure);
    counts.countByStatusAndType.mockResolvedValueOnce({ cells: [] });

    await expect(statistics.get({})).rejects.toBe(failure);
  });

  it('lets a failure to read the counts per status and type through', async () => {
    const failure = new Error('database unreachable');
    counts.count.mockResolvedValueOnce(ZERO_COUNTS);
    counts.countByStatusAndType.mockRejectedValueOnce(failure);

    await expect(statistics.get({})).rejects.toBe(failure);
  });

  it('Counts without filters: every job per status and per type, every key present', async () => {
    counts.count.mockResolvedValueOnce(ZERO_COUNTS);
    counts.countByStatusAndType.mockResolvedValueOnce(CELLS);

    const { stats } = await statistics.get({});

    expect(stats.counts).toEqual({
      status: { ...NO_STATUS_COUNTS, failed: 3, completed: 1, pending: 1 },
      type: { ...NO_TYPE_COUNTS, webhook: 3, email: 2 },
    });
  });

  it('counts the status and type pairs of the requested group only', async () => {
    counts.count.mockResolvedValueOnce(ZERO_COUNTS);
    counts.countByStatusAndType.mockResolvedValueOnce(CELLS);

    await statistics.get({ groupId: null });

    expect(counts.countByStatusAndType).toHaveBeenCalledExactlyOnceWith({ groupId: null });
  });

  it('Status counts under a type filter: only jobs of that type, type counts unfiltered', async () => {
    counts.count.mockResolvedValueOnce(ZERO_COUNTS);
    counts.countByStatusAndType.mockResolvedValueOnce(CELLS);

    const { stats } = await statistics.get({ type: 'webhook' });

    expect(stats.counts).toEqual({
      status: { ...NO_STATUS_COUNTS, failed: 2, completed: 1 },
      type: { ...NO_TYPE_COUNTS, webhook: 3, email: 2 },
    });
  });

  it('Type counts under a status filter: only jobs in that status, status counts unfiltered', async () => {
    counts.count.mockResolvedValueOnce(ZERO_COUNTS);
    counts.countByStatusAndType.mockResolvedValueOnce(CELLS);

    const { stats } = await statistics.get({ status: 'failed' });

    expect(stats.counts).toEqual({
      status: { ...NO_STATUS_COUNTS, failed: 3, completed: 1, pending: 1 },
      type: { ...NO_TYPE_COUNTS, webhook: 2, email: 1 },
    });
  });

  it('Both filters: each facet narrowed by the other filter only', async () => {
    counts.count.mockResolvedValueOnce(ZERO_COUNTS);
    counts.countByStatusAndType.mockResolvedValueOnce(CELLS);

    const { stats } = await statistics.get({ status: 'failed', type: 'webhook' });

    expect(stats.counts).toEqual({
      status: { ...NO_STATUS_COUNTS, failed: 2, completed: 1 },
      type: { ...NO_TYPE_COUNTS, webhook: 2, email: 1 },
    });
  });

  it('gives zero for every count when the filters match no job', async () => {
    counts.count.mockResolvedValueOnce(ZERO_COUNTS);
    counts.countByStatusAndType.mockResolvedValueOnce(CELLS);

    const { stats } = await statistics.get({ status: 'cancelled', type: 'flight-transit' });

    expect(stats.counts).toEqual({ status: NO_STATUS_COUNTS, type: NO_TYPE_COUNTS });
  });

  it('Filters leave the other statistics unchanged', async () => {
    const current = {
      pending: 4,
      processing: 2,
      scheduled: 1,
      recentCompleted: 30,
      recentFailed: 3,
      throughputCompleted: 10,
    };
    counts.count.mockResolvedValueOnce(current);
    counts.countByStatusAndType.mockResolvedValueOnce(CELLS);
    const { stats: unfiltered } = await statistics.get({});
    clock.now.mockReturnValueOnce({ now: new Date(NOW) });
    counts.count.mockResolvedValueOnce(current);
    counts.countByStatusAndType.mockResolvedValueOnce(CELLS);

    const { stats: filtered } = await statistics.get({ status: 'failed', type: 'webhook' });

    const { counts: _unfilteredCounts, ...unfilteredRest } = unfiltered;
    const { counts: _filteredCounts, ...filteredRest } = filtered;
    expect(filteredRest).toEqual(unfilteredRest);
    expect(counts.count).toHaveBeenNthCalledWith(2, {
      recentSince: '2026-10-29T12:00:00.000Z',
      throughputSince: '2026-10-30T11:55:00.000Z',
    });
  });
});
