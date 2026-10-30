import { randomUUID } from 'node:crypto';

import type { JobLogStreamMessage } from '@job-queue/contracts';
import type { Clock, Sleeper } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

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
  let sleeper: DeepMockProxy<Sleeper>;
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

  /** A sleep that lasts until the writer is stopped: ends a scenario without further rounds. */
  const parkOnSleep = (): void => {
    sleeper.sleep.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('stopped'));
          });
        }),
    );
  };
  /** The round after the scenario: no lease, then parked in the wait for the next round. */
  const endWithIdleRound = (): void => {
    stream.lease.mockResolvedValueOnce({ held: false });
    parkOnSleep();
  };
  const startAndWaitUntilParked = async (sleeps: number): Promise<void> => {
    writer.start();
    await vi.waitFor(() => {
      expect(sleeper.sleep).toHaveBeenCalledTimes(sleeps);
    });
  };
  const sleepDelays = (): number[] => sleeper.sleep.mock.calls.map(([req]) => req.ms);

  beforeEach(() => {
    stream = mockDeep<JobLogStream>();
    store = mockDeep<JobLogStore>();
    schema = mockDeep<JobLogSchema>();
    sleeper = mockDeep<Sleeper>();
    clock = mockDeep<Clock>();
    logger = mockDeep<Pick<LoggerService, 'warn'>>();
    writer = new JobLogWriterImpl(
      { stream, store, schema, sleeper, clock, logger },
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
  });

  it('stores a full batch at once and confirms it', async () => {
    const entries = [message(1), message(2), message(3)];
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records: entries.map((e, i) => recordOf(i, e)) });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(1);

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
    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
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

    await startAndWaitUntilParked(1);

    expect(stream.read).toHaveBeenNthCalledWith(3, {
      pending: false,
      count: BATCH_SIZE - 1,
      blockMs: FLUSH_INTERVAL_MS,
    });
    expect(store.insert).toHaveBeenCalledExactlyOnceWith({ entries: [positionedOf(1, entry)] });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
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

    await startAndWaitUntilParked(1);

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
    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
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

    await startAndWaitUntilParked(1);

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
    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
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

    await startAndWaitUntilParked(1);

    const insertOrder = store.insert.mock.invocationCallOrder[0] ?? Infinity;
    const ackOrder = stream.ack.mock.invocationCallOrder[0] ?? 0;
    expect(insertOrder).toBeLessThan(ackOrder);
    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads and stores the entries left unconfirmed before reading new ones', async () => {
    const entry = message(1);
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, entry)] });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(1);

    expect(stream.read).toHaveBeenCalledExactlyOnceWith({
      pending: true,
      count: BATCH_SIZE,
      blockMs: 0,
    });
    expect(store.insert).toHaveBeenCalledExactlyOnceWith({ entries: [positionedOf(1, entry)] });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('Log store down while a job runs: the same batch is retried after the backoff delay and nothing new is read', async () => {
    const entries = [message(1), message(2), message(3)];
    const records = entries.map((e, i) => recordOf(i, e));
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    sleeper.sleep.mockResolvedValueOnce({});
    stream.lease.mockResolvedValueOnce({ held: true });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(2);

    expect(sleepDelays()[0]).toBe(RETRY_DELAY_MS);
    expect(store.insert).toHaveBeenCalledTimes(2);
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
      sleeper.sleep.mockResolvedValueOnce({});
      stream.lease.mockResolvedValueOnce({ held: true });
    }
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(5);

    expect(sleepDelays().slice(0, 4)).toEqual([100, 200, 350, 350]);
  });

  it('starts the wait over for the next batch after a store succeeded', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({
      records: [recordOf(1, message(1)), recordOf(2, message(2)), recordOf(3, message(3))],
    });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    sleeper.sleep.mockResolvedValueOnce({});
    stream.lease.mockResolvedValueOnce({ held: true });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({
      records: [recordOf(4, message(4)), recordOf(5, message(5)), recordOf(6, message(6))],
    });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    sleeper.sleep.mockResolvedValueOnce({});
    stream.lease.mockResolvedValueOnce({ held: true });
    store.insert.mockResolvedValueOnce({});
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(3);

    expect(sleepDelays().slice(0, 2)).toEqual([RETRY_DELAY_MS, RETRY_DELAY_MS]);
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

    await startAndWaitUntilParked(1);

    expect(store.insert).toHaveBeenCalledExactlyOnceWith({ entries: [positionedOf(3, valid)] });
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({
      positions: ['1001-0', '1002-0', '1003-0'],
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('1001-0'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('1002-0'));
    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
  });

  it('confirms a batch that holds only malformed messages without calling the store', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [{ position: '1001-0', body: '' }] });
    stream.ack.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(1);

    expect(store.insert).not.toHaveBeenCalled();
    expect(stream.ack).toHaveBeenCalledExactlyOnceWith({ positions: ['1001-0'] });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
  });

  it('reads nothing while another instance holds the lease', async () => {
    stream.lease.mockResolvedValueOnce({ held: false });
    parkOnSleep();

    await startAndWaitUntilParked(1);

    expect(sleepDelays()).toEqual([FLUSH_INTERVAL_MS]);
    expect(stream.read).not.toHaveBeenCalled();
  });

  it('abandons a batch it can no longer retry safely when the lease passed to another instance', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({
      records: [recordOf(1, message(1)), recordOf(2, message(2)), recordOf(3, message(3))],
    });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    sleeper.sleep.mockResolvedValueOnce({});
    stream.lease.mockResolvedValueOnce({ held: false });
    endWithIdleRound();

    await startAndWaitUntilParked(2);

    expect(store.insert).toHaveBeenCalledTimes(1);
    expect(stream.ack).not.toHaveBeenCalled();
  });

  it('creates the consumer group again on the next round when it could not be created', async () => {
    stream.prepare.mockReset();
    stream.prepare.mockRejectedValueOnce(new Error('redis down'));
    sleeper.sleep.mockResolvedValueOnce({});
    stream.prepare.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(2);

    expect(stream.prepare).toHaveBeenCalledTimes(2);
    expect(sleepDelays()[0]).toBe(RETRY_DELAY_MS);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('applies the store schema before it reads anything', async () => {
    endWithIdleRound();

    await startAndWaitUntilParked(1);

    expect(schema.apply).toHaveBeenCalledOnce();
    expect(schema.apply.mock.invocationCallOrder[0]).toBeLessThan(
      stream.lease.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('Job log store down at startup: applies the schema again on the next round and reads nothing meanwhile', async () => {
    schema.apply.mockReset();
    schema.apply.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'schema' }));
    sleeper.sleep.mockResolvedValueOnce({});
    schema.apply.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(2);

    expect(schema.apply).toHaveBeenCalledTimes(2);
    expect(sleepDelays()[0]).toBe(RETRY_DELAY_MS);
    expect(stream.lease).toHaveBeenCalledOnce();
    expect(stream.read).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('waits and goes on when reading the stream fails', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    sleeper.sleep.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(2);

    expect(sleepDelays()).toEqual([RETRY_DELAY_MS, FLUSH_INTERVAL_MS]);
    expect(stream.lease).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('doubles the wait between rounds that keep failing', async () => {
    schema.apply.mockReset();
    schema.apply.mockRejectedValueOnce(new Error('store down'));
    sleeper.sleep.mockResolvedValueOnce({});
    schema.apply.mockRejectedValueOnce(new Error('store down'));
    sleeper.sleep.mockResolvedValueOnce({});
    schema.apply.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(3);

    expect(sleepDelays()).toEqual([RETRY_DELAY_MS, 2 * RETRY_DELAY_MS, FLUSH_INTERVAL_MS]);
  });

  it('doubles the wait between rounds that keep failing to read the stream', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    sleeper.sleep.mockResolvedValueOnce({});
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    sleeper.sleep.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(3);

    expect(sleepDelays()).toEqual([RETRY_DELAY_MS, 2 * RETRY_DELAY_MS, FLUSH_INTERVAL_MS]);
  });

  it('starts the round wait over after a round that worked', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    sleeper.sleep.mockResolvedValueOnce({});
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.read.mockResolvedValueOnce({ records: [] });
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockRejectedValueOnce(new Error('redis down'));
    sleeper.sleep.mockResolvedValueOnce({});
    endWithIdleRound();

    await startAndWaitUntilParked(3);

    expect(sleepDelays()).toEqual([RETRY_DELAY_MS, RETRY_DELAY_MS, FLUSH_INTERVAL_MS]);
  });

  it('runs one loop when started twice', async () => {
    endWithIdleRound();

    writer.start();
    writer.start();
    await vi.waitFor(() => {
      expect(sleeper.sleep).toHaveBeenCalledTimes(1);
    });

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
    writer.start();
    await vi.waitFor(() => {
      expect(stream.read).toHaveBeenCalledTimes(2);
    });

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
    writer.start();
    await vi.waitFor(() => {
      expect(stream.read).toHaveBeenCalledTimes(2);
    });

    const stopped = writer.stop();
    fail(new Error('connection closed'));
    await expect(stopped).resolves.toEqual({});

    expect(logger.warn).not.toHaveBeenCalled();
    expect(sleeper.sleep).not.toHaveBeenCalled();
  });

  it('stops without confirming a batch that is not stored yet', async () => {
    stream.lease.mockResolvedValueOnce({ held: true });
    stream.read.mockResolvedValueOnce({ records: [recordOf(1, message(1))] });
    store.insert.mockRejectedValueOnce(new LogStoreUnavailableError({ operation: 'insert' }));
    parkOnSleep();
    await startAndWaitUntilParked(1);

    await expect(writer.stop()).resolves.toEqual({});

    expect(stream.ack).not.toHaveBeenCalled();
    expect(store.insert).toHaveBeenCalledTimes(1);
  });

  it('stops a writer that was never started', async () => {
    await expect(writer.stop()).resolves.toEqual({});
  });
});
