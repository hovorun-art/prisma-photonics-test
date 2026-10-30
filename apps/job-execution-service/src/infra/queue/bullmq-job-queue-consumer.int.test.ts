import { randomUUID } from 'node:crypto';

import { JOB_QUEUE_NAME, JobQueueEntryId } from '@job-queue/contracts';
import { CONTAINER_IMAGES } from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { JobQueueEntry } from '../../domain/queue/job-queue-consumer.js';
import { BullMqJobQueueConsumer } from './bullmq-job-queue-consumer.js';

const JOB_ID = randomUUID();
const FIRST_JOB_ID = randomUUID();
const SECOND_JOB_ID = randomUUID();

const POLL = { timeout: 10_000, interval: 50 };

describe('BullMqJobQueueConsumer against Redis', () => {
  let container: StartedRedisContainer;
  let producer: Queue;
  let consumer: BullMqJobQueueConsumer | undefined;

  /** Adds an entry the way job-service does: data `{ jobId }`, id `<jobId>_<run>_<attempt>`. */
  const enqueue = async (jobId: string, attempt = 1, run = 1): Promise<void> => {
    const entryId = JobQueueEntryId.encode({ jobId, run, attempt });
    await producer.add(entryId, { jobId }, { jobId: entryId });
  };

  const startConsumer = (
    concurrency: number,
    execute: (entry: JobQueueEntry) => Promise<unknown>,
  ): BullMqJobQueueConsumer => {
    consumer = new BullMqJobQueueConsumer(
      { logger: { warn: vi.fn(), error: vi.fn() } },
      { redisUrl: container.getConnectionUrl(), concurrency },
    );
    consumer.start({ execute });
    return consumer;
  };

  beforeAll(async () => {
    container = await new RedisContainer(CONTAINER_IMAGES.redis).start();
    producer = new Queue(JOB_QUEUE_NAME, { connection: { url: container.getConnectionUrl() } });
  });
  afterEach(async () => {
    await consumer?.close();
    consumer = undefined;
    await producer.obliterate({ force: true });
  });
  afterAll(async () => {
    await producer.close();
    await container.stop();
  });

  it('hands each entry to execute with its job id and attempt', async () => {
    const seen: JobQueueEntry[] = [];
    startConsumer(1, (entry) => {
      seen.push(entry);
      return Promise.resolve();
    });

    await enqueue(JOB_ID, 2, 3);

    await expect.poll(() => seen, POLL).toEqual([{ jobId: JOB_ID, attempt: 2 }]);
  });

  it('takes an entry queued before runs existed (`<jobId>_<attempt>`)', async () => {
    const seen: JobQueueEntry[] = [];
    startConsumer(1, (entry) => {
      seen.push(entry);
      return Promise.resolve();
    });

    await producer.add(`${JOB_ID}_2`, { jobId: JOB_ID }, { jobId: `${JOB_ID}_2` });

    await expect.poll(() => seen, POLL).toEqual([{ jobId: JOB_ID, attempt: 2 }]);
  });

  it('drops a malformed entry with an error log and does not run it', async () => {
    const error = vi.fn<(message: unknown, context?: string) => void>();
    const seen: JobQueueEntry[] = [];
    consumer = new BullMqJobQueueConsumer(
      { logger: { warn: vi.fn(), error } },
      { redisUrl: container.getConnectionUrl(), concurrency: 1 },
    );
    consumer.start({
      execute: (entry) => {
        seen.push(entry);
        return Promise.resolve();
      },
    });
    const otherId = JobQueueEntryId.encode({ jobId: randomUUID(), run: 1, attempt: 1 });

    // An id that is no entry id, and an id of another job than the entry's data.
    await producer.add('bad', { jobId: JOB_ID }, { jobId: 'not-an-entry-id' });
    await producer.add('mismatch', { jobId: JOB_ID }, { jobId: otherId });
    await enqueue(SECOND_JOB_ID);

    await expect.poll(() => seen, POLL).toEqual([{ jobId: SECOND_JOB_ID, attempt: 1 }]);
    expect(error.mock.calls).toEqual([
      [{ entryId: 'not-an-entry-id' }, 'Dropped a malformed queue entry'],
      [{ entryId: otherId }, 'Dropped a malformed queue entry'],
    ]);
  });

  it('Failed attempt is not redelivered', async () => {
    let calls = 0;
    startConsumer(1, () => {
      calls += 1;
      return Promise.resolve({ outcome: 'failed' });
    });

    await enqueue(JOB_ID);

    await expect.poll(() => producer.getCompletedCount(), POLL).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(calls).toBe(1);
  });

  it('Concurrent jobs within one instance', async () => {
    let running = 0;
    let maxRunning = 0;
    let done = 0;
    startConsumer(2, async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 200));
      running -= 1;
      done += 1;
    });

    for (let i = 0; i < 5; i += 1) await enqueue(randomUUID());

    await expect.poll(() => done, POLL).toBe(5);
    expect(maxRunning).toBe(2);
  });

  it('stops taking entries on close and waits for running ones', async () => {
    let release: () => void = () => undefined;
    const started: string[] = [];
    const running = startConsumer(1, (entry) => {
      started.push(entry.jobId);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await enqueue(FIRST_JOB_ID);
    await expect.poll(() => started.length, POLL).toBe(1);

    let closed = false;
    const closing = running.close().then(() => {
      closed = true;
    });
    await enqueue(SECOND_JOB_ID);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(closed).toBe(false);

    release();
    await closing;
    consumer = undefined;
    expect(started).toEqual([FIRST_JOB_ID]);
  });
});
