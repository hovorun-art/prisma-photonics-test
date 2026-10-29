import { JOB_QUEUE_NAME } from '@job-queue/contracts';
import { CONTAINER_IMAGES, UNREACHABLE_REDIS_URL } from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { JobQueueUnavailableError } from '../../../domain/jobs/errors/job-queue-unavailable.error.js';
import { BullMqJobQueue } from './bullmq-job-queue.js';

const JOB_ID = '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b';
const ENQUEUE_TIMEOUT_MS = 500;

describe('BullMqJobQueue against Redis', () => {
  let container: StartedRedisContainer;
  let observer: Queue;
  let queue: BullMqJobQueue;

  beforeAll(async () => {
    container = await new RedisContainer(CONTAINER_IMAGES.redis).start();
    observer = new Queue(JOB_QUEUE_NAME, { connection: { url: container.getConnectionUrl() } });
    queue = new BullMqJobQueue(
      { logger: { warn: vi.fn() } },
      { redisUrl: container.getConnectionUrl(), enqueueTimeoutMs: ENQUEUE_TIMEOUT_MS },
    );
  });
  afterEach(async () => {
    await observer.obliterate({ force: true });
  });
  afterAll(async () => {
    await queue.close();
    await observer.close();
    await container.stop();
  });

  it('Submitted job is queued', async () => {
    await expect(queue.enqueue({ jobId: JOB_ID, attempt: 1 })).resolves.toEqual({});

    const entry = await observer.getJob(`${JOB_ID}_1`);
    expect(entry?.data).toEqual({ jobId: JOB_ID });
    expect(await observer.getJobCountByTypes('waiting')).toBe(1);
  });

  it('Same attempt is not queued twice', async () => {
    await queue.enqueue({ jobId: JOB_ID, attempt: 1 });
    await queue.enqueue({ jobId: JOB_ID, attempt: 1 });

    expect(await observer.getJobCountByTypes('waiting')).toBe(1);
  });

  it('queues each attempt of a job as its own entry', async () => {
    await queue.enqueue({ jobId: JOB_ID, attempt: 1 });
    await queue.enqueue({ jobId: JOB_ID, attempt: 2 });

    expect(await observer.getJobCountByTypes('waiting')).toBe(2);
    expect((await observer.getJob(`${JOB_ID}_2`))?.data).toEqual({ jobId: JOB_ID });
  });

  it('rejects within the configured timeout while Redis cannot be reached', async () => {
    const unreachable = new BullMqJobQueue(
      { logger: { warn: vi.fn() } },
      { redisUrl: UNREACHABLE_REDIS_URL, enqueueTimeoutMs: ENQUEUE_TIMEOUT_MS },
    );
    const startedAt = performance.now();

    await expect(unreachable.enqueue({ jobId: JOB_ID, attempt: 1 })).rejects.toBeInstanceOf(
      JobQueueUnavailableError,
    );
    expect(performance.now() - startedAt).toBeLessThan(ENQUEUE_TIMEOUT_MS * 4);

    await unreachable.close();
  });
});
