import { randomUUID } from 'node:crypto';

import { ClickHouseError, createClient, type ClickHouseClient } from '@clickhouse/client';
import type { JobLogStreamMessage } from '@job-queue/contracts';
import { CONTAINER_IMAGES, UNREACHABLE_HTTP_URL } from '@job-queue/test-support';
import { ClickHouseContainer, type StartedClickHouseContainer } from '@testcontainers/clickhouse';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LogStoreUnavailableError } from '../../../domain/job-log/errors/log-store-unavailable.error.js';
import type { PositionedJobLogEntry } from '../../../domain/job-log/job-log-store.js';
import { ClickHouseJobLogSchema } from './clickhouse-job-log-schema.js';
import { ClickHouseJobLogStore } from './clickhouse-job-log-store.js';

const JOB_ID = randomUUID();
const OTHER_JOB_ID = randomUUID();
const NOW_MS = Date.now();
const MS_PER_DAY = 86_400_000;

describe('ClickHouseJobLogStore against ClickHouse', () => {
  let container: StartedClickHouseContainer;
  let client: ClickHouseClient;
  let store: ClickHouseJobLogStore;

  const positioned = (
    n: number,
    over: Partial<JobLogStreamMessage> = {},
  ): PositionedJobLogEntry => ({
    position: `${NOW_MS + n}-0`,
    entry: {
      id: randomUUID(),
      jobId: JOB_ID,
      level: 'info',
      message: `entry ${n}`,
      metadata: {},
      ts: NOW_MS + n,
      source: 'job-service',
      ...over,
    },
  });

  beforeAll(async () => {
    container = await new ClickHouseContainer(CONTAINER_IMAGES.clickhouse).start();
    client = createClient({ url: container.getConnectionUrl() });
    await new ClickHouseJobLogSchema({ client }, { retentionDays: 30 }).apply();
    store = new ClickHouseJobLogStore({ client }, { retentionDays: 30 });
  });
  beforeEach(async () => {
    await client.command({ query: 'TRUNCATE TABLE job_log' });
  });
  afterAll(async () => {
    await client.close();
    await container.stop();
  });

  it('returns one job entries in stream order with every field', async () => {
    const full = positioned(2, {
      attempt: 2,
      level: 'warning',
      metadata: { code: 'E', nested: { a: [1, 'x'] } },
      source: 'job-execution-service',
      instanceId: 'worker-1',
    });
    const first = positioned(1);
    await store.insert({
      entries: [full, first, positioned(3, { jobId: OTHER_JOB_ID }), positioned(4)],
    });

    const { entries } = await store.query({ jobId: JOB_ID, limit: 10 });

    expect(entries.map((e) => e.entry.message)).toEqual(['entry 1', 'entry 2', 'entry 4']);
    expect(entries[0]).toEqual(first);
    expect(entries[1]).toEqual(full);
  });

  it('returns at most the limit', async () => {
    await store.insert({ entries: [positioned(1), positioned(2), positioned(3)] });

    const { entries } = await store.query({ jobId: JOB_ID, limit: 2 });

    expect(entries.map((e) => e.entry.message)).toEqual(['entry 1', 'entry 2']);
  });

  it('returns only the entries after the cursor position', async () => {
    const cursor = positioned(1);
    await store.insert({ entries: [cursor, positioned(2), positioned(3)] });

    const { entries } = await store.query({ jobId: JOB_ID, after: cursor.position, limit: 10 });

    expect(entries.map((e) => e.entry.message)).toEqual(['entry 2', 'entry 3']);
  });

  it('orders entries that share a millisecond by their sequence number', async () => {
    const a = { ...positioned(1), position: `${NOW_MS}-2` };
    const b = { ...positioned(2), position: `${NOW_MS}-10` };
    await store.insert({ entries: [b, a] });

    const { entries } = await store.query({ jobId: JOB_ID, limit: 10 });
    expect(entries.map((e) => e.position)).toEqual([a.position, b.position]);

    const later = await store.query({ jobId: JOB_ID, after: a.position, limit: 10 });
    expect(later.entries.map((e) => e.position)).toEqual([b.position]);
  });

  it('keeps only the entries of the given levels', async () => {
    await store.insert({
      entries: [
        positioned(1),
        positioned(2, { level: 'warning' }),
        positioned(3, { level: 'error' }),
      ],
    });

    const one = await store.query({ jobId: JOB_ID, levels: ['error'], limit: 10 });
    const two = await store.query({ jobId: JOB_ID, levels: ['info', 'warning'], limit: 10 });

    expect(one.entries.map((e) => e.entry.level)).toEqual(['error']);
    expect(two.entries.map((e) => e.entry.level)).toEqual(['info', 'warning']);
  });

  it('applies the level filter before the limit and the cursor', async () => {
    await store.insert({
      entries: [
        positioned(1),
        positioned(2, { level: 'error' }),
        positioned(3),
        positioned(4, { level: 'error' }),
        positioned(5, { level: 'error' }),
      ],
    });

    const first = await store.query({ jobId: JOB_ID, levels: ['error'], limit: 2 });
    const last = first.entries[first.entries.length - 1];
    const second = await store.query({
      jobId: JOB_ID,
      levels: ['error'],
      after: last?.position,
      limit: 2,
    });

    expect(first.entries.map((e) => e.entry.message)).toEqual(['entry 2', 'entry 4']);
    expect(second.entries.map((e) => e.entry.message)).toEqual(['entry 5']);
  });

  it('returns nothing for a job without entries', async () => {
    await expect(store.query({ jobId: OTHER_JOB_ID, limit: 10 })).resolves.toEqual({
      entries: [],
    });
  });

  it('Writer crash after storing a batch: the same batch inserted twice reads once', async () => {
    const batch = [positioned(1), positioned(2)];

    await store.insert({ entries: batch });
    await store.insert({ entries: batch });

    const { entries } = await store.query({ jobId: JOB_ID, limit: 10 });
    expect(entries.map((e) => e.entry.message)).toEqual(['entry 1', 'entry 2']);
  });

  it('inserts an empty batch without error', async () => {
    await expect(store.insert({ entries: [] })).resolves.toEqual({});
  });

  it('Expired entries: entries older than the retention are gone after a merge', async () => {
    await new ClickHouseJobLogSchema({ client }, { retentionDays: 1 }).apply();
    try {
      await store.insert({
        entries: [positioned(1, { ts: NOW_MS - 3 * MS_PER_DAY }), positioned(2)],
      });

      await client.command({ query: 'OPTIMIZE TABLE job_log FINAL' });

      const { entries } = await store.query({ jobId: JOB_ID, limit: 10 });
      expect(entries.map((e) => e.entry.message)).toEqual(['entry 2']);
    } finally {
      await new ClickHouseJobLogSchema({ client }, { retentionDays: 30 }).apply();
    }
  });

  it('Expired entries: entries older than the retention are not returned before any merge', async () => {
    const shortRetention = new ClickHouseJobLogStore({ client }, { retentionDays: 1 });
    await store.insert({
      entries: [positioned(1, { ts: NOW_MS - 3 * MS_PER_DAY }), positioned(2)],
    });

    const { entries } = await shortRetention.query({ jobId: JOB_ID, limit: 10 });

    expect(entries.map((e) => e.entry.message)).toEqual(['entry 2']);
  });

  it('a failure that is not about reaching the store is not reported as unavailable', async () => {
    await client.command({ query: 'RENAME TABLE job_log TO job_log_moved' });
    try {
      const failures = await Promise.all([
        store.query({ jobId: JOB_ID, limit: 1 }).catch((error: unknown) => error),
        store.insert({ entries: [positioned(1)] }).catch((error: unknown) => error),
      ]);

      for (const failure of failures) {
        expect(failure).toBeInstanceOf(ClickHouseError);
        expect(failure).not.toBeInstanceOf(LogStoreUnavailableError);
      }
    } finally {
      await client.command({ query: 'RENAME TABLE job_log_moved TO job_log' });
    }
  });

  it('a store that cannot be reached makes insert and query throw LogStoreUnavailableError', async () => {
    const unreachable = new ClickHouseJobLogStore(
      { client: createClient({ url: UNREACHABLE_HTTP_URL }) },
      { retentionDays: 30 },
    );

    await expect(unreachable.insert({ entries: [positioned(1)] })).rejects.toMatchObject({
      code: 'LOG_STORE_UNAVAILABLE',
      details: { operation: 'insert' },
    });
    await expect(unreachable.query({ jobId: JOB_ID, limit: 1 })).rejects.toMatchObject({
      code: 'LOG_STORE_UNAVAILABLE',
      details: { operation: 'query' },
    });
    await unreachable.close();
  });

  it('a stopped container makes insert and query throw LogStoreUnavailableError', async () => {
    const own = await new ClickHouseContainer(CONTAINER_IMAGES.clickhouse).start();
    const ownClient = createClient({ url: own.getConnectionUrl() });
    await new ClickHouseJobLogSchema({ client: ownClient }, { retentionDays: 30 }).apply();
    const ownStore = new ClickHouseJobLogStore({ client: ownClient }, { retentionDays: 30 });
    await own.stop();

    await expect(ownStore.insert({ entries: [positioned(1)] })).rejects.toMatchObject({
      code: 'LOG_STORE_UNAVAILABLE',
      details: { operation: 'insert' },
    });
    await expect(ownStore.query({ jobId: JOB_ID, limit: 1 })).rejects.toMatchObject({
      code: 'LOG_STORE_UNAVAILABLE',
      details: { operation: 'query' },
    });
    await ownStore.close();
  });
});
