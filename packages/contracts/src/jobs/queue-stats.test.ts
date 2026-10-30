import { describe, expect, it } from 'vitest';

import { QueueStats } from './queue-stats.js';

const validStats = {
  pending: 3,
  processing: 1,
  scheduled: 0,
  recent: { windowMinutes: 1440, completed: 12, failed: 2 },
  throughput: { windowMinutes: 5, perMinute: 2.4 },
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
});
