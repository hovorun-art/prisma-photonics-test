import { randomUUID } from 'node:crypto';

import { JOB_QUEUE_NAME, JobQueueEntryId } from '@job-queue/contracts';
import { CONTAINER_IMAGES, UNREACHABLE_REDIS_URL } from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { JobQueueUnavailableError } from '../../../domain/jobs/errors/job-queue-unavailable.error.js';
import { BullMqJobQueue } from './bullmq-job-queue.js';

const JOB_ID = randomUUID();
const ENQUEUE_TIMEOUT_MS = 500;

describe('BullMqJobQueue against Redis', () => {
  let container: StartedRedisContainer;
  let observer: Queue;
  let queue: BullMqJobQueue;

  /** Stalls every client's writes (reads go on), so an enqueue waits on Redis until unpaused. */
  const pauseWrites = async (): Promise<void> => {
    await container.exec(['redis-cli', 'CLIENT', 'PAUSE', String(ENQUEUE_TIMEOUT_MS * 10), 'WRITE']);
  };
  const unpauseWrites = async (): Promise<void> => {
    await container.exec(['redis-cli', 'CLIENT', 'UNPAUSE']);
  };

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

    const entry = await observer.getJob(JobQueueEntryId.encode({ jobId: JOB_ID, attempt: 1 }));
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
    expect(
      (await observer.getJob(JobQueueEntryId.encode({ jobId: JOB_ID, attempt: 2 })))?.data,
    ).toEqual({ jobId: JOB_ID });
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

  it('gives up after the configured timeout while Redis stalls, and the entry may still land later', async () => {
    await pauseWrites();
    const startedAt = performance.now();
    try {
      await expect(queue.enqueue({ jobId: JOB_ID, attempt: 1 })).rejects.toBeInstanceOf(
        JobQueueUnavailableError,
      );
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(ENQUEUE_TIMEOUT_MS - 1);
      expect(performance.now() - startedAt).toBeLessThan(ENQUEUE_TIMEOUT_MS * 4);
    } finally {
      await unpauseWrites();
    }

    await vi.waitFor(async () => {
      expect(await observer.getJobCountByTypes('waiting')).toBe(1);
    });
  });

  describe('enqueueMany', () => {
    const OTHER_JOB_ID = randomUUID();

    it('Every bulk job is queued', async () => {
      await expect(
        queue.enqueueMany({
          entries: [
            { jobId: JOB_ID, attempt: 1 },
            { jobId: OTHER_JOB_ID, attempt: 1 },
          ],
        }),
      ).resolves.toEqual({});

      expect(await observer.getJobCountByTypes('waiting')).toBe(2);
      for (const jobId of [JOB_ID, OTHER_JOB_ID]) {
        const entry = await observer.getJob(JobQueueEntryId.encode({ jobId, attempt: 1 }));
        expect(entry?.data).toEqual({ jobId });
      }
    });

    it('does not add an entry that is already on the queue a second time', async () => {
      await queue.enqueue({ jobId: JOB_ID, attempt: 1 });

      await queue.enqueueMany({
        entries: [
          { jobId: JOB_ID, attempt: 1 },
          { jobId: OTHER_JOB_ID, attempt: 1 },
        ],
      });

      expect(await observer.getJobCountByTypes('waiting')).toBe(2);
    });

    it('adds one entry when the same attempt appears twice in one call', async () => {
      await queue.enqueueMany({
        entries: [
          { jobId: JOB_ID, attempt: 1 },
          { jobId: JOB_ID, attempt: 1 },
        ],
      });

      expect(await observer.getJobCountByTypes('waiting')).toBe(1);
    });

    it('rejects at once, names every entry and logs the job ids while Redis cannot be reached', async () => {
      const warn = vi.fn();
      const unreachable = new BullMqJobQueue(
        { logger: { warn } },
        { redisUrl: UNREACHABLE_REDIS_URL, enqueueTimeoutMs: ENQUEUE_TIMEOUT_MS },
      );
      const entries = [
        { jobId: JOB_ID, attempt: 1 },
        { jobId: OTHER_JOB_ID, attempt: 1 },
      ];
      const startedAt = performance.now();
      try {
        const error: unknown = await unreachable
          .enqueueMany({ entries })
          .catch((err: unknown) => err);

        expect(error).toBeInstanceOf(JobQueueUnavailableError);
        expect((error as JobQueueUnavailableError).details).toEqual({ entries });
        expect(performance.now() - startedAt).toBeLessThan(ENQUEUE_TIMEOUT_MS * 4);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ jobIds: [JOB_ID, OTHER_JOB_ID] }),
          'Bulk enqueue failed',
        );
      } finally {
        await unreachable.close();
      }
    });

    it('gives up after the configured timeout while Redis stalls, and the entries may still land later', async () => {
      const entries = [
        { jobId: JOB_ID, attempt: 1 },
        { jobId: OTHER_JOB_ID, attempt: 1 },
      ];
      await pauseWrites();
      const startedAt = performance.now();
      try {
        const error: unknown = await queue.enqueueMany({ entries }).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(JobQueueUnavailableError);
        expect((error as JobQueueUnavailableError).details).toEqual({ entries });
        expect(performance.now() - startedAt).toBeGreaterThanOrEqual(ENQUEUE_TIMEOUT_MS - 1);
        expect(performance.now() - startedAt).toBeLessThan(ENQUEUE_TIMEOUT_MS * 4);
      } finally {
        await unpauseWrites();
      }

      await vi.waitFor(async () => {
        expect(await observer.getJobCountByTypes('waiting')).toBe(2);
      });
    });
  });
});
