import { randomUUID } from 'node:crypto';

import type { JobLogStreamMessage } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import { JobLogStreamGroupMissingError } from '../../domain/job-log/errors/job-log-stream-group-missing.error.js';
import { LogStoreUnavailableError } from '../../domain/job-log/errors/log-store-unavailable.error.js';
import type { JobLogSchema } from '../../domain/job-log/job-log-schema.js';
import type { JobLogStore } from '../../domain/job-log/job-log-store.js';
import type { JobLogStream, JobLogStreamRecord } from '../../domain/job-log/job-log-stream.js';
import { JobLogWriterImpl } from './job-log-writer.impl.js';

const BATCH_SIZE = 3;
const FLUSH_INTERVAL_MS = 1000;
const RETRY_DELAY_MS = 100;
const RETRY_MAX_DELAY_MS = 350;
const T0 = new Date('2030-01-01T00:00:00.000Z');

describe('JobLogWriterImpl', () => {
  let stream: DeepMockProxy<JobLogStream>;
  let store: DeepMockProxy<JobLogStore>;
  let schema: DeepMockProxy<JobLogSchema>;
  let clock: DeepMockProxy<Clock>;
  let logger: DeepMockProxy<Pick<LoggerService, 'warn'>>;
  let writer: JobLogWriterImpl;

  const message = (n: number): JobLogStreamMessage => ({
    id: randomUUID(),
    jobId: randomUUID(),
    level: 'info',
    message: `entry ${n}`,
    metadata: {},
    ts: 1_000 + n,
    source: 'job-service',
  });
  const recordOf = (n: number, entry: JobLogStreamMessage): JobLogStreamRecord => ({
    position: `${1_000 + n}-0`,
    body: JSON.stringify(entry),
  });
  const positionedOf = (n: number, entry: JobLogStreamMessage) => ({
    position: `${1_000 + n}-0`,
    entry,
  });

  /** The round after the scenario: no lease, so the writer idles for a flush interval. */
  const endWithIdleRound = (): void => {
    stream.lease.mockResolvedValueOnce({ held: false });
  };
  /** Lets everything that does not wait on a timer run. */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };
  const startAndSettle = async (): Promise<void> => {
    writer.start();
    await settle();
  };
  /** Asserts `before` before `ms` has passed and `after` once it has. */
  const afterWait = async (ms: number, before: () => void, after: () => void): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms - 1);
    before();
    await vi.advanceTimersByTimeAsync(1);
    after();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    stream = mockDeep<JobLogStream>();
    store = mockDeep<JobLogStore>();
    schema = mockDeep<JobLogSchema>();
    clock = mockDeep<Clock>();
    logger = mockDeep<Pick<LoggerService, 'warn'>>();
    writer = new JobLogWriterImpl(
      { stream, store, schema, clock, logger },
      {
        batchSize: BATCH_SIZE,
        flushIntervalMs: FLUSH_INTERVAL_MS,
        retryDelayMs: RETRY_DELAY_MS,
        retryMaxDelayMs: RETRY_MAX_DELAY_MS,
      },
    );
    schema.apply.mockResolvedValueOnce({});
    stream.prepare.mockResolvedValueOnce({});
  });
  afterEach(async () => {
    await writer.stop();
    vi.useRealTimers();
  });

  it('stores a full batch at once and confirms it', async () => {
    const entries = [message(1), message(2), message(3)];
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records: entries.map((e, i) => recordOf(i, e)) });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    expect(store.insert).toHaveBeenCalledExactlyOnceWith({
      entries: entries.map((e, i) => positionedOf(i, e)),
    });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({
      positions: entries.map((_, i) => `${1_000 + i}-0`),
    });
    expect(stream.read).toHaveBeenNthCalledWith(2, {
      pending: false,
      count: BATCH_SIZE,
      blockMs: FLUSH_INTERVAL_MS,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stores a partial batch once the flush interval has passed', async () => {
    const entry = message(1);
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, entry)] });
    clock.now.mockReturnValueOnce({ now: T0 });
    clock.now.mockReturnValueOnce({ now: T0 });
    stream.read.mockResolvedValueOnce({ records: [] });
    clock.now.mockReturnValueOnce({ now: new Date(T0.getTime() + FLUSH_INTERVAL_MS) });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    expect(stream.read).toHaveBeenNthCalledWith(3, {
      pending: false,
      count: BATCH_SIZE - 1,
      blockMs: FLUSH_INTERVAL_MS,
    });
    expect(store.insert).toHaveBeenCalledExactlyOnceWith({ entries: [positionedOf(1, entry)] });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('tops up a short batch with entries that arrive before the flush interval ends', async () => {
    const [first, second, third] = [message(1), message(2), message(3)] as const;
    const entries = [first, second, third];
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, first)] });
    clock.now.mockReturnValueOnce({ now: T0 });
    clock.now.mockReturnValueOnce({ now: new Date(T0.getTime() + 300) });
    stream.read.mockResolvedValueOnce({
      records: [recordOf(2, second), recordOf(3, third)],
    });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    expect(stream.read).toHaveBeenNthCalledWith(3, {
      pending: false,
      count: BATCH_SIZE - 1,
      blockMs: FLUSH_INTERVAL_MS - 300,
    });
    expect(store.insert).toHaveBeenCalledExactlyOnceWith({
      entries: entries.map((e, i) => positionedOf(i + 1, e)),
    });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({
      positions: ['1001-0', '1002-0', '1003-0'],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('tops up a short batch with two reads when the first adds only part of it', async () => {
    const [first, second, third] = [message(1), message(2), message(3)] as const;
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, first)] });
    clock.now.mockReturnValueOnce({ now: T0 });
    clock.now.mockReturnValueOnce({ now: new Date(T0.getTime() + 100) });
    stream.read.mockResolvedValueOnce({ records: [recordOf(2, second)] });
    clock.now.mockReturnValueOnce({ now: new Date(T0.getTime() + 400) });
    stream.read.mockResolvedValueOnce({ records: [recordOf(3, third)] });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    expect(stream.read).toHaveBeenCalledTimes(4);
    expect(stream.read).toHaveBeenNthCalledWith(3, {
      pending: false,
      count: 2,
      blockMs: FLUSH_INTERVAL_MS - 100,
    });
    expect(stream.read).toHaveBeenNthCalledWith(4, {
      pending: false,
      count: 1,
      blockMs: FLUSH_INTERVAL_MS - 400,
    });
    expect(store.insert).toHaveBeenCalledExactlyOnceWith({
      entries: [positionedOf(1, first), positionedOf(2, second), positionedOf(3, third)],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('confirms a batch only after it is stored', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({
      records: [recordOf(1, message(1)), recordOf(2, message(2)), recordOf(3, message(3))],
    });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    const insertOrder = store.insert.mock.invocationCallOrder[0] ?? Infinity;
    const ackOrder = stream.ack.mock.invocationCallOrder[0] ?? 0;
    expect(insertOrder).toBeLessThan(ackOrder);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads and stores the entries left unconfirmed before reading new ones', async () => {
    const entry = message(1);
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, entry)] });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    expect(stream.read).toHaveBeenCalledExactlyOnceWith({
      pending: true,
      count: BATCH_SIZE,
      blockMs: 0,
    });
    expect(store.insert).toHaveBeenCalledExactlyOnceWith({ entries: [positionedOf(1, entry)] });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('Log store down while a job runs: the same batch is retried after the backoff delay and nothing new is read', async () => {
    const entries = [message(1), message(2), message(3)];
    const records = entries.map((e, i) => recordOf(i, e));
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    stream.lease.mockResolvedValueOnce({ held: true });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(store.insert).toHaveBeenCalledTimes(1);
        expect(stream.ack).not.toHaveBeenCalled();
      },
      () => {
        expect(store.insert).toHaveBeenCalledTimes(2);
      },
    );

    expect(store.insert).toHaveBeenNthCalledWith(1, {
      entries: entries.map((e, i) => positionedOf(i, e)),
    });
    expect(store.insert).toHaveBeenNthCalledWith(2, {
      entries: entries.map((e, i) => positionedOf(i, e)),
    });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({
      positions: records.map((r) => r.position),
    });
    expect(stream.read).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('doubles the wait after each failed store up to the maximum', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, message(1))] });
    clock.now.mockReturnValueOnce({ now: T0 });
    clock.now.mockReturnValueOnce({ now: T0 });
    stream.read.mockResolvedValueOnce({ records: [] });
    clock.now.mockReturnValueOnce({ now: new Date(T0.getTime() + FLUSH_INTERVAL_MS) });
    for (let i = 0; i < 4; i += 1) {
      store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
      stream.lease.mockResolvedValueOnce({ held: true });
    }
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    let inserts = 1;
    for (const delay of [100, 200, 350, 350]) {
      const expected = inserts;
      await afterWait(
        delay,
        () => {
          expect(store.insert).toHaveBeenCalledTimes(expected);
        },
        () => {
          expect(store.insert).toHaveBeenCalledTimes(expected + 1);
        },
      );
      inserts += 1;
    }
    expect(stream.ack).toHaveBeenCalledOnce();
  });

  it('starts the wait over for the next batch after a store succeeded', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({
      records: [recordOf(1, message(1)), recordOf(2, message(2)), recordOf(3, message(3))],
    });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    stream.lease.mockResolvedValueOnce({ held: true });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({
      records: [recordOf(4, message(4)), recordOf(5, message(5)), recordOf(6, message(6))],
    });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    stream.lease.mockResolvedValueOnce({ held: true });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(store.insert).toHaveBeenCalledTimes(3);

    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(store.insert).toHaveBeenCalledTimes(3);
      },
      () => {
        expect(store.insert).toHaveBeenCalledTimes(4);
      },
    );
    expect(stream.ack).toHaveBeenCalledTimes(2);
  });

  it('logs a malformed message and confirms it with the rest of the batch without storing it', async () => {
    const valid = message(3);
    const notJson = { position: '1001-0', body: 'not json' };
    const wrongShape = { position: '1002-0', body: JSON.stringify({ id: 'x', level: 'debug' }) };
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [notJson, wrongShape, recordOf(3, valid)] });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    expect(store.insert).toHaveBeenCalledExactlyOnceWith({ entries: [positionedOf(3, valid)] });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({
      positions: ['1001-0', '1002-0', '1003-0'],
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('1001-0'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('1002-0'));
  });

  it('confirms a batch that holds only malformed messages without calling the store', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [{ position: '1001-0', body: '' }] });
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();

    expect(store.insert).not.toHaveBeenCalled();
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('reads nothing while another instance holds the lease, and asks again after a flush interval', async () => {
    stream.lease.mockResolvedValueOnce({ held: false });
    stream.lease.mockResolvedValueOnce({ held: false });

    await startAndSettle();
    expect(stream.lease).toHaveBeenCalledTimes(1);

    await afterWait(
      FLUSH_INTERVAL_MS,
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(1);
      },
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(2);
      },
    );
    expect(stream.read).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('abandons a batch it can no longer retry safely when the lease passed to another instance', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({
      records: [recordOf(1, message(1)), recordOf(2, message(2)), recordOf(3, message(3))],
    });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    stream.lease.mockResolvedValueOnce({ held: false });
    endWithIdleRound();

    await startAndSettle();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(stream.ack).not.toHaveBeenCalled();
    expect(stream.lease).toHaveBeenCalledTimes(3);
  });

  it('creates the consumer group again on the next round when it could not be created', async () => {
    stream.prepare.mockReset();
    stream.prepare.mockRejectedValueOnce(new Error('redis down'));
    stream.prepare.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    expect(stream.prepare).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(stream.prepare).toHaveBeenCalledTimes(1);
      },
      () => {
        expect(stream.prepare).toHaveBeenCalledTimes(2);
      },
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('prepares the stream before it applies the store schema, so entries wait in the stream while the store is down', async () => {
    schema.apply.mockReset();
    schema.apply.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'schema' }));
    schema.apply.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    expect(schema.apply).toHaveBeenCalledTimes(2);
    expect(stream.prepare).toHaveBeenCalledOnce();
    expect(stream.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      schema.apply.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('creates the consumer group again on the next round after a read finds it missing', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new JobLogStreamGroupMissingError());
    stream.prepare.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    expect(stream.prepare).toHaveBeenCalledTimes(1);

    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(stream.prepare).toHaveBeenCalledTimes(1);
      },
      () => {
        expect(stream.prepare).toHaveBeenCalledTimes(2);
      },
    );
    expect(stream.prepare.mock.invocationCallOrder[1]).toBeGreaterThan(
      stream.read.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(stream.lease).toHaveBeenCalledTimes(2);
    expect(schema.apply).toHaveBeenCalledOnce();
  });

  it('does not create the consumer group again after a round that failed for another reason', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    endWithIdleRound();

    await startAndSettle();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    expect(stream.lease).toHaveBeenCalledTimes(2);
    expect(stream.prepare).toHaveBeenCalledOnce();
  });

  it('Job log store down at startup: applies the schema again on the next round and reads nothing meanwhile', async () => {
    schema.apply.mockReset();
    schema.apply.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'schema' }));
    schema.apply.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    expect(schema.apply).toHaveBeenCalledTimes(1);
    expect(stream.lease).not.toHaveBeenCalled();
    expect(stream.read).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(schema.apply).toHaveBeenCalledTimes(1);
      },
      () => {
        expect(schema.apply).toHaveBeenCalledTimes(2);
      },
    );
    expect(stream.lease).toHaveBeenCalledOnce();
    expect(schema.apply.mock.invocationCallOrder[1]).toBeLessThan(
      stream.lease.mock.invocationCallOrder[0] ?? 0,
    );
    expect(stream.read).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('doubles the wait between rounds that keep failing to read the stream', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    endWithIdleRound();

    await startAndSettle();
    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(1);
      },
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(2);
      },
    );
    await afterWait(
      2 * RETRY_DELAY_MS,
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(2);
      },
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(3);
      },
    );
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('starts the round wait over after a round that worked', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    endWithIdleRound();

    await startAndSettle();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(stream.lease).toHaveBeenCalledTimes(3);

    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(3);
      },
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(4);
      },
    );
  });

  it.each([
    ['a TypeError', () => new TypeError('x')],
    ['a value that is not an Error', () => 'boom'],
  ])('retries a batch whose store fails with %s', async (_name, failure) => {
    const entry = message(1);
    const records = [recordOf(1, entry)];
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records });
    store.insert.mockRejectedValueOnce(failure());
    stream.lease.mockResolvedValueOnce({ held: true });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(store.insert).toHaveBeenCalledTimes(1);
      },
      () => {
        expect(store.insert).toHaveBeenCalledTimes(2);
      },
    );

    expect(store.insert).toHaveBeenNthCalledWith(2, { entries: [positionedOf(1, entry)] });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    await expect(writer.stop()).resolves.toEqual({});
  });

  it.each([
    ['a TypeError', () => new TypeError('x')],
    ['a value that is not an Error', () => 'boom'],
  ])('goes on to the next round when reading the stream fails with %s', async (_name, failure) => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(failure());
    endWithIdleRound();

    await startAndSettle();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(1);
      },
      () => {
        expect(stream.lease).toHaveBeenCalledTimes(2);
      },
    );

    await expect(writer.stop()).resolves.toEqual({});
  });

  it('counts a failed lease check before a retry as a failed attempt and retries after the doubled wait', async () => {
    const records = [recordOf(1, message(1))];
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    stream.lease.mockRejectedValueOnce(new Error('redis down'));
    stream.lease.mockResolvedValueOnce({ held: true });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(store.insert).toHaveBeenCalledTimes(1);

    await afterWait(
      2 * RETRY_DELAY_MS,
      () => {
        expect(store.insert).toHaveBeenCalledTimes(1);
        expect(stream.ack).not.toHaveBeenCalled();
      },
      () => {
        expect(store.insert).toHaveBeenCalledTimes(2);
      },
    );
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    expect(stream.read).toHaveBeenCalledTimes(1);
  });

  it('stops quietly when an insert that is in flight fails after the writer was asked to stop', async () => {
    let fail: (error: Error) => void = () => undefined;
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, message(1))] });
    store.insert.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await startAndSettle();
    expect(store.insert).toHaveBeenCalledTimes(1);

    const stopped = writer.stop();
    fail(new LogStoreUnavailableError({ operation: 'insert' }));
    await expect(stopped).resolves.toEqual({});
    await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);

    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(stream.ack).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads the same records again and stores them once more when confirming them fails', async () => {
    const entry = message(1);
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, entry)] });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockRejectedValueOnce(new Error('redis down'));
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, entry)] });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndSettle();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await afterWait(
      RETRY_DELAY_MS,
      () => {
        expect(stream.read).toHaveBeenCalledTimes(1);
      },
      () => {
        expect(stream.read).toHaveBeenCalledTimes(2);
      },
    );

    expect(stream.read).toHaveBeenNthCalledWith(2, {
      pending: true,
      count: BATCH_SIZE,
      blockMs: 0,
    });
    expect(store.insert).toHaveBeenCalledTimes(2);
    expect(store.insert).toHaveBeenNthCalledWith(2, { entries: [positionedOf(1, entry)] });
    expect(stream.ack).toHaveBeenCalledTimes(2);
    expect(stream.ack).toHaveBeenNthCalledWith(2, { positions: ['1001-0'] });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('stores what it has without topping up when the writer is asked to stop during the first read', async () => {
    const entry = message(1);
    let deliver: (reply: { records: JobLogStreamRecord[] }) => void = () => undefined;
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    await startAndSettle();
    expect(stream.read).toHaveBeenCalledTimes(2);

    const stopped = writer.stop();
    deliver({ records: [recordOf(1, entry)] });
    await expect(stopped).resolves.toEqual({});

    expect(stream.read).toHaveBeenCalledTimes(2);
    expect(store.insert).toHaveBeenCalledExactlyOnceWith({ entries: [positionedOf(1, entry)] });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    expect(stream.lease).toHaveBeenCalledOnce();
  });

  it('runs one loop when started twice', async () => {
    endWithIdleRound();

    writer.start();
    writer.start();
    await settle();

    expect(schema.apply).toHaveBeenCalledOnce();
    expect(stream.lease).toHaveBeenCalledOnce();
  });

  it('finishes and confirms the batch a read returns after the writer was asked to stop, then reads nothing more', async () => {
    const entries = [message(1), message(2), message(3)];
    let deliver: (reply: { records: JobLogStreamRecord[] }) => void = () => undefined;
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    await startAndSettle();
    expect(stream.read).toHaveBeenCalledTimes(2);

    const stopped = writer.stop();
    deliver({ records: entries.map((e, i) => recordOf(i, e)) });
    await expect(stopped).resolves.toEqual({});

    expect(store.insert).toHaveBeenCalledExactlyOnceWith({
      entries: entries.map((e, i) => positionedOf(i, e)),
    });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({
      positions: ['1000-0', '1001-0', '1002-0'],
    });
    expect(stream.read).toHaveBeenCalledTimes(2);
    expect(stream.lease).toHaveBeenCalledOnce();
  });

  it('stops quietly when a read that is in flight fails after the writer was asked to stop', async () => {
    let fail: (error: Error) => void = () => undefined;
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await startAndSettle();
    expect(stream.read).toHaveBeenCalledTimes(2);

    const stopped = writer.stop();
    fail(new Error('connection closed'));
    await expect(stopped).resolves.toEqual({});

    expect(logger.warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops during a wait between failed rounds without trying again', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    await startAndSettle();
    expect(vi.getTimerCount()).toBe(1);

    await expect(writer.stop()).resolves.toEqual({});
    await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);

    expect(vi.getTimerCount()).toBe(0);
    expect(stream.lease).toHaveBeenCalledTimes(1);
  });

  it('stops during the idle wait without another round', async () => {
    endWithIdleRound();
    await startAndSettle();
    expect(vi.getTimerCount()).toBe(1);

    await expect(writer.stop()).resolves.toEqual({});

    expect(vi.getTimerCount()).toBe(0);
    expect(stream.lease).toHaveBeenCalledTimes(1);
  });

  it('stops without confirming a batch that is not stored yet', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, message(1))] });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    await startAndSettle();
    expect(store.insert).toHaveBeenCalledTimes(1);

    await expect(writer.stop()).resolves.toEqual({});
    await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);

    expect(stream.ack).not.toHaveBeenCalled();
    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a writer that was never started', async () => {
    await expect(writer.stop()).resolves.toEqual({});
  });
});
