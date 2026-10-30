import { randomUUID } from 'node:crypto';

import { JOB_LOG_STREAM_NAME } from '@job-queue/contracts';
import {
  ClientListRedisConnectionCounter,
  CONTAINER_IMAGES,
  UNREACHABLE_REDIS_URL,
} from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { JobLogStreamGroupMissingError } from '../../../domain/job-log/errors/job-log-stream-group-missing.error.js';
import { RedisJobLogStream } from './redis-job-log-stream.js';

const LEASE_MS = 400;
const BLOCK_MS = 200;
const CONNECTION_NAME = 'job-log-stream-test';
const POLL = { timeout: 10_000, interval: 100 };
const UNAVAILABLE_BOUND_MS = 5000;

describe('RedisJobLogStream against Redis', () => {
  let container: StartedRedisContainer;
  let producer: Redis;
  let counter: ClientListRedisConnectionCounter;
  const opened: RedisJobLogStream[] = [];

  const open = (instanceId = randomUUID()): RedisJobLogStream => {
    const stream = new RedisJobLogStream({
      redisUrl: container.getConnectionUrl(),
      connectionName: CONNECTION_NAME,
      instanceId,
      leaseMs: LEASE_MS,
    });
    opened.push(stream);
    return stream;
  };
  const append = async (data: string): Promise<void> => {
    await producer.xadd(JOB_LOG_STREAM_NAME, '*', 'data', data);
  };

  beforeAll(async () => {
    container = await new RedisContainer(CONTAINER_IMAGES.redis).start();
    producer = new Redis(container.getConnectionUrl());
    counter = new ClientListRedisConnectionCounter({ redisUrl: container.getConnectionUrl() });
  });
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((stream) => stream.close()));
    await producer.flushall();
  });
  afterAll(async () => {
    producer.disconnect();
    await counter.close();
    await container.stop();
  });

  it('creates the consumer group once and tolerates it existing', async () => {
    const stream = open();

    await expect(stream.prepare()).resolves.toEqual({});
    await expect(stream.prepare()).resolves.toEqual({});
    await expect(open().prepare()).resolves.toEqual({});

    const groups = (await producer.xinfo('GROUPS', JOB_LOG_STREAM_NAME)) as unknown[][];
    expect(groups).toHaveLength(1);
  });

  it('reads new entries with their positions and bodies, at most the count', async () => {
    const stream = open();
    await stream.prepare();
    await append('one');
    await append('two');
    await append('three');

    const { records } = await stream.read({ pending: false, count: 2, blockMs: BLOCK_MS });

    expect(records.map((r) => r.body)).toEqual(['one', 'two']);
    expect(records[0]?.position).toMatch(/^\d+-\d+$/);
  });

  it('returns nothing after waiting when there are no new entries', async () => {
    const stream = open();
    await stream.prepare();

    await expect(stream.read({ pending: false, count: 10, blockMs: 50 })).resolves.toEqual({
      records: [],
    });
  });

  it('returns entries appended before the group was created', async () => {
    await append('before');
    const stream = open();
    await stream.prepare();
    await append('after');

    const { records } = await stream.read({ pending: false, count: 10, blockMs: BLOCK_MS });

    expect(records.map((r) => r.body)).toEqual(['before', 'after']);
  });

  it('rejects a read with JobLogStreamGroupMissingError when the group does not exist', async () => {
    const stream = open();
    await stream.prepare();
    await producer.del(JOB_LOG_STREAM_NAME);

    await expect(
      stream.read({ pending: false, count: 10, blockMs: BLOCK_MS }),
    ).rejects.toBeInstanceOf(JobLogStreamGroupMissingError);
    await expect(stream.read({ pending: true, count: 10, blockMs: 0 })).rejects.toBeInstanceOf(
      JobLogStreamGroupMissingError,
    );
  });

  it('rejects a read on a key of the wrong type, but not as a missing group', async () => {
    const stream = open();
    await producer.set(JOB_LOG_STREAM_NAME, 'not a stream');

    const failure = await stream
      .read({ pending: false, count: 10, blockMs: BLOCK_MS })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(JobLogStreamGroupMissingError);
  });

  it('reads again after the group is created again', async () => {
    const stream = open();
    await stream.prepare();
    await producer.del(JOB_LOG_STREAM_NAME);
    await append('one');
    await stream.prepare();

    const { records } = await stream.read({ pending: false, count: 10, blockMs: BLOCK_MS });

    expect(records.map((r) => r.body)).toEqual(['one']);
  });

  it('reads unacknowledged entries again at the next start', async () => {
    const first = open();
    await first.prepare();
    await append('one');
    await append('two');
    const read = await first.read({ pending: false, count: 10, blockMs: BLOCK_MS });
    await first.close();

    const restarted = open();
    await restarted.prepare();
    const pending = await restarted.read({ pending: true, count: 10, blockMs: 0 });
    const fresh = await restarted.read({ pending: false, count: 10, blockMs: 50 });

    expect(pending.records).toEqual(read.records);
    expect(fresh.records).toEqual([]);
  });

  it('does not read acknowledged entries again', async () => {
    const stream = open();
    await stream.prepare();
    await append('one');
    await append('two');
    const { records } = await stream.read({ pending: false, count: 10, blockMs: BLOCK_MS });

    await expect(stream.ack({ positions: [records[0]?.position ?? ''] })).resolves.toEqual({});

    const pending = await stream.read({ pending: true, count: 10, blockMs: 0 });
    expect(pending.records.map((r) => r.body)).toEqual(['two']);
  });

  it('acknowledging nothing is a no-op', async () => {
    const stream = open();
    await stream.prepare();

    await expect(stream.ack({ positions: [] })).resolves.toEqual({});
  });

  it('gives the lease to one instance at a time and passes it on after it expires', async () => {
    const a = open();
    const b = open();

    expect(await a.lease()).toEqual({ held: true });
    expect(await b.lease()).toEqual({ held: false });
    expect(await a.lease()).toEqual({ held: true });
    expect(await b.lease()).toEqual({ held: false });

    await expect
      .poll(async () => (await b.lease()).held, { timeout: 5000, interval: 100 })
      .toBe(true);
    expect(await a.lease()).toEqual({ held: false });
  });

  it('keeps the lease while the holder renews it, past the first expiry', async () => {
    const a = open();
    const b = open();

    expect(await a.lease()).toEqual({ held: true });
    await new Promise((resolve) => setTimeout(resolve, LEASE_MS * 0.75));
    expect(await a.lease()).toEqual({ held: true });
    await new Promise((resolve) => setTimeout(resolve, LEASE_MS * 0.75));

    expect(await b.lease()).toEqual({ held: false });
  });

  it('returns an entry trimmed while pending with its position and an empty body', async () => {
    const stream = open();
    await stream.prepare();
    await append('one');
    const { records } = await stream.read({ pending: false, count: 10, blockMs: BLOCK_MS });
    await producer.xtrim(JOB_LOG_STREAM_NAME, 'MAXLEN', 0);

    const pending = await stream.read({ pending: true, count: 10, blockMs: 0 });

    expect(pending.records).toEqual([{ position: records[0]?.position, body: '' }]);
  });

  it('closes its connection', async () => {
    const stream = open();
    await stream.prepare();
    await expect
      .poll(async () => (await counter.count({ name: CONNECTION_NAME })).connections, POLL)
      .toBe(1);

    await expect(stream.close()).resolves.toEqual({});

    await expect
      .poll(async () => (await counter.count({ name: CONNECTION_NAME })).connections, POLL)
      .toBe(0);
  });

  it('closes without opening a connection when it never connected', async () => {
    const stream = open();

    await expect(stream.close()).resolves.toEqual({});

    expect((await counter.count({ name: CONNECTION_NAME })).connections).toBe(0);
  });

  it('rejects lease, read and ack within a bounded time when Redis is unreachable', async () => {
    const stream = new RedisJobLogStream({
      redisUrl: UNREACHABLE_REDIS_URL,
      connectionName: CONNECTION_NAME,
      instanceId: randomUUID(),
      leaseMs: LEASE_MS,
    });
    opened.push(stream);
    const startedAt = Date.now();

    await expect(stream.lease()).rejects.toThrow();
    await expect(stream.read({ pending: false, count: 1, blockMs: BLOCK_MS })).rejects.toThrow();
    await expect(stream.ack({ positions: ['1-0'] })).rejects.toThrow();

    expect(Date.now() - startedAt).toBeLessThan(UNAVAILABLE_BOUND_MS);
  }, 15_000);
});
