import { describe, expect, it } from 'vitest';

import { QueryStatsRequest, QueueStats } from './queue-stats.js';

const validStats = {
  pending: 3,
  processing: 1,
  scheduled: 0,
  recent: { windowMinutes: 1440, completed: 12, failed: 2 },
  throughput: { windowMinutes: 5, perMinute: 2.4 },
  counts: {
    status: { scheduled: 0, pending: 3, processing: 1, completed: 40, failed: 2, cancelled: 1 },
    type: { email: 30, webhook: 15, 'flight-transit': 2 },
  },
};

describe('QueueStats', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    QueueStats.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

  it('accepts a full statistics body', () => {
    expect(QueueStats.parse(validStats)).toEqual(validStats);
  });

  it('accepts zero for every count and the throughput', () => {
    const empty = {
      pending: 0,
      processing: 0,
      scheduled: 0,
      recent: { windowMinutes: 1440, completed: 0, failed: 0 },
      throughput: { windowMinutes: 5, perMinute: 0 },
      counts: {
        status: { scheduled: 0, pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 },
        type: { email: 0, webhook: 0, 'flight-transit': 0 },
      },
    };

    expect(QueueStats.parse(empty)).toEqual(empty);
  });

  it('accepts a window of one minute', () => {
    const shortest = {
      ...validStats,
      recent: { ...validStats.recent, windowMinutes: 1 },
      throughput: { ...validStats.throughput, windowMinutes: 1 },
    };

    expect(QueueStats.parse(shortest)).toEqual(shortest);
  });

  it.each([
    { path: ['pending'], body: { ...validStats, pending: -1 } },
    { path: ['processing'], body: { ...validStats, processing: -1 } },
    { path: ['scheduled'], body: { ...validStats, scheduled: -1 } },
    {
      path: ['recent', 'completed'],
      body: { ...validStats, recent: { ...validStats.recent, completed: -1 } },
    },
    {
      path: ['recent', 'failed'],
      body: { ...validStats, recent: { ...validStats.recent, failed: -1 } },
    },
  ])('rejects a negative count at $path', ({ path, body }) => {
    expect(issuePaths(body)).toEqual([path]);
  });

  it('rejects a count that is not a whole number', () => {
    expect(issuePaths({ ...validStats, processing: 1.5 })).toEqual([['processing']]);
  });

  it('rejects a count that is a string or null', () => {
    expect(issuePaths({ ...validStats, pending: '3' })).toEqual([['pending']]);
    expect(issuePaths({ ...validStats, pending: null })).toEqual([['pending']]);
  });

  it('rejects a missing recent or throughput object', () => {
    const { recent: _recent, ...withoutRecent } = validStats;
    const { throughput: _throughput, ...withoutThroughput } = validStats;

    expect(issuePaths(withoutRecent)).toEqual([['recent']]);
    expect(issuePaths(withoutThroughput)).toEqual([['throughput']]);
  });

  it('rejects a negative throughput', () => {
    expect(
      issuePaths({ ...validStats, throughput: { ...validStats.throughput, perMinute: -0.1 } }),
    ).toEqual([['throughput', 'perMinute']]);
  });

  it('rejects a zero or missing window length', () => {
    expect(
      issuePaths({ ...validStats, recent: { ...validStats.recent, windowMinutes: 0 } }),
    ).toEqual([['recent', 'windowMinutes']]);
    expect(
      issuePaths({ ...validStats, throughput: { ...validStats.throughput, windowMinutes: 0 } }),
    ).toEqual([['throughput', 'windowMinutes']]);
    expect(issuePaths({ ...validStats, throughput: { perMinute: 1 } })).toEqual([
      ['throughput', 'windowMinutes'],
    ]);
  });

  it('rejects a window length that is not a whole number', () => {
    expect(
      issuePaths({ ...validStats, throughput: { ...validStats.throughput, windowMinutes: 1.5 } }),
    ).toEqual([['throughput', 'windowMinutes']]);
  });

  it('rejects a missing count', () => {
    const { scheduled: _scheduled, ...withoutScheduled } = validStats;

    expect(issuePaths(withoutScheduled)).toEqual([['scheduled']]);
  });

  it('rejects counts without a known status or type key', () => {
    const { failed: _failed, ...statusWithoutFailed } = validStats.counts.status;
    const { webhook: _webhook, ...typeWithoutWebhook } = validStats.counts.type;

    expect(
      issuePaths({ ...validStats, counts: { ...validStats.counts, status: statusWithoutFailed } }),
    ).toEqual([['counts', 'status', 'failed']]);
    expect(
      issuePaths({ ...validStats, counts: { ...validStats.counts, type: typeWithoutWebhook } }),
    ).toEqual([['counts', 'type', 'webhook']]);
  });

  it('rejects a count for an unknown status or type', () => {
    expect(
      issuePaths({
        ...validStats,
        counts: { ...validStats.counts, type: { ...validStats.counts.type, batch: 1 } },
      }),
    ).toEqual([['counts', 'type']]);
    expect(
      issuePaths({
        ...validStats,
        counts: { ...validStats.counts, status: { ...validStats.counts.status, archived: 1 } },
      }),
    ).toEqual([['counts', 'status']]);
  });

  it('rejects counts without the status or the type part', () => {
    expect(issuePaths({ ...validStats, counts: { type: validStats.counts.type } })).toEqual([
      ['counts', 'status'],
    ]);
    expect(issuePaths({ ...validStats, counts: { status: validStats.counts.status } })).toEqual([
      ['counts', 'type'],
    ]);
  });

  it('rejects a negative or fractional job count', () => {
    expect(
      issuePaths({
        ...validStats,
        counts: { ...validStats.counts, status: { ...validStats.counts.status, failed: -1 } },
      }),
    ).toEqual([['counts', 'status', 'failed']]);
    expect(
      issuePaths({
        ...validStats,
        counts: { ...validStats.counts, type: { ...validStats.counts.type, email: 1.5 } },
      }),
    ).toEqual([['counts', 'type', 'email']]);
  });

  it('rejects a missing counts part', () => {
    const { counts: _counts, ...withoutCounts } = validStats;

    expect(issuePaths(withoutCounts)).toEqual([['counts']]);
  });
});

describe('QueryStatsRequest', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    QueryStatsRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

  it('accepts no filters', () => {
    expect(QueryStatsRequest.parse({})).toEqual({});
  });

  it('accepts one status, one type, or both', () => {
    expect(QueryStatsRequest.parse({ status: 'failed' })).toEqual({ status: 'failed' });
    expect(QueryStatsRequest.parse({ type: 'flight-transit' })).toEqual({ type: 'flight-transit' });
    expect(QueryStatsRequest.parse({ status: 'failed', type: 'webhook' })).toEqual({
      status: 'failed',
      type: 'webhook',
    });
  });

  it.each([
    { field: 'status', value: 'unknown' },
    { field: 'type', value: 'batch' },
    { field: 'status', value: '' },
    { field: 'type', value: '' },
    { field: 'status', value: ['failed', 'cancelled'] },
    { field: 'type', value: ['email', 'email'] },
  ])('rejects $field = $value with an issue on that field', ({ field, value }) => {
    expect(issuePaths({ [field]: value })).toEqual([[field]]);
  });
});
