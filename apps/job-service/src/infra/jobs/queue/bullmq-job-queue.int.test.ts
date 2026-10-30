import { randomUUID } from 'node:crypto';

import { setTimeout as sleep } from 'node:timers/promises';

import { JOB_LIMITS, JOB_QUEUE_NAME, JobQueueEntryId } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';
import { CONTAINER_IMAGES, UNREACHABLE_REDIS_URL } from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue, Worker } from 'bullmq';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { JobQueueUnavailableError } from '../../../domain/jobs/errors/job-queue-unavailable.error.js';
import type { EnqueueJobQueueRequest } from '../../../domain/jobs/job-queue.js';
import { BullMqJobQueue } from './bullmq-job-queue.js';

const JOB_ID = randomUUID();
const ENQUEUE_TIMEOUT_MS = 500;
/** job-service's time as the adapter sees it; the delay of an entry is `runAt` minus this. */
const NOW = new Date('2026-10-30T12:00:00.000Z');
/** Long enough to look for the entry before it is due, short enough for a test. */
const DELAY_MS = 1_500;

describe('BullMqJobQueue against Redis', () => {
  /** An entry of the default priority, available at once, unless `overrides` say otherwise. */
  const entry = (
    jobId: string,
    attempt: number,
    overrides: Partial<EnqueueJobQueueRequest> = {},
  ): EnqueueJobQueueRequest => ({
    jobId,
    attempt,
    priority: JOB_LIMITS.priority.default,
    runAt: null,
    ...overrides,
  });
  const inMs = (ms: number): string => new Date(NOW.getTime() + ms).toISOString();

  let container: StartedRedisContainer;
  let observer: Queue;
  let taker: Worker;
  let clock: DeepMockProxy<Clock>;
  let queue: BullMqJobQueue;

  /** Takes the next entry the way a worker would, finishes it, and returns its job id. */
  const takeNext = async (): Promise<string | undefined> => {
    const token = randomUUID();
    const next = (await taker.getNextJob(token, { block: false })) as
      Awaited<ReturnType<Worker['getNextJob']>> | undefined;
    if (next === undefined) return undefined;
    await next.moveToCompleted('done', token, false);
    return (next.data as { jobId: string }).jobId;
  };
  const takeAll = async (count: number): Promise<(string | undefined)[]> => {
    const taken: (string | undefined)[] = [];
    for (let i = 0; i < count; i++) taken.push(await takeNext());
    return taken;
  };

  /** Stalls every client's writes (reads go on), so an enqueue waits on Redis until unpaused. */
  const pauseWrites = async (): Promise<void> => {
    await container.exec([
      'redis-cli',
      'CLIENT',
      'PAUSE',
      String(ENQUEUE_TIMEOUT_MS * 10),
      'WRITE',
    ]);
  };
  const unpauseWrites = async (): Promise<void> => {
    await container.exec(['redis-cli', 'CLIENT', 'UNPAUSE']);
  };

  beforeAll(async () => {
    container = await new RedisContainer(CONTAINER_IMAGES.redis).start();
    observer = new Queue(JOB_QUEUE_NAME, { connection: { url: container.getConnectionUrl() } });
    taker = new Worker(JOB_QUEUE_NAME, null, {
      connection: { url: container.getConnectionUrl() },
      autorun: false,
    });
    clock = mockDeep<Clock>();
    queue = new BullMqJobQueue(
      { logger: { warn: vi.fn() }, clock },
      { redisUrl: container.getConnectionUrl(), enqueueTimeoutMs: ENQUEUE_TIMEOUT_MS },
    );
  });
  afterEach(async () => {
    await observer.obliterate({ force: true });
    clock.now.mockReset();
  });
  afterAll(async () => {
    await queue.close();
    await taker.close();
    await observer.close();
    await container.stop();
  });

  it('Submitted job is queued', async () => {
    await expect(queue.enqueue(entry(JOB_ID, 1))).resolves.toEqual({});

    const queued = await observer.getJob(JobQueueEntryId.encode({ jobId: JOB_ID, attempt: 1 }));
    expect(queued?.data).toEqual({ jobId: JOB_ID });
    expect(await observer.getJobCountByTypes('waiting', 'prioritized')).toBe(1);
  });

  it('Same attempt is not queued twice', async () => {
    await queue.enqueue(entry(JOB_ID, 1));
    await queue.enqueue(entry(JOB_ID, 1));

    expect(await observer.getJobCountByTypes('waiting', 'prioritized')).toBe(1);
  });

  it('queues each attempt of a job as its own entry', async () => {
    await queue.enqueue(entry(JOB_ID, 1));
    await queue.enqueue(entry(JOB_ID, 2));

    expect(await observer.getJobCountByTypes('waiting', 'prioritized')).toBe(2);
    expect(
      (await observer.getJob(JobQueueEntryId.encode({ jobId: JOB_ID, attempt: 2 })))?.data,
    ).toEqual({ jobId: JOB_ID });
  });

  it('rejects within the configured timeout, names the attempt and logs it while Redis cannot be reached', async () => {
    const warn = vi.fn();
    const unreachable = new BullMqJobQueue(
      { logger: { warn }, clock },
      { redisUrl: UNREACHABLE_REDIS_URL, enqueueTimeoutMs: ENQUEUE_TIMEOUT_MS },
    );
    const startedAt = performance.now();
    try {
      const error: unknown = await unreachable
        .enqueue(entry(JOB_ID, 1))
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(JobQueueUnavailableError);
      expect((error as JobQueueUnavailableError).details).toEqual({ jobId: JOB_ID, attempt: 1 });
      expect(performance.now() - startedAt).toBeLessThan(ENQUEUE_TIMEOUT_MS * 4);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID, attempt: 1 }),
        'Enqueue failed',
      );
    } finally {
      await unreachable.close();
    }
  });

  it('gives up after the configured timeout while Redis stalls, and the entry may still land later', async () => {
    await pauseWrites();
    const startedAt = performance.now();
    try {
      await expect(queue.enqueue(entry(JOB_ID, 1))).rejects.toBeInstanceOf(
        JobQueueUnavailableError,
      );
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(ENQUEUE_TIMEOUT_MS - 1);
      expect(performance.now() - startedAt).toBeLessThan(ENQUEUE_TIMEOUT_MS * 4);
    } finally {
      await unpauseWrites();
    }

    await vi.waitFor(async () => {
      expect(await observer.getJobCountByTypes('waiting', 'prioritized')).toBe(1);
    });
  });

  describe('enqueueMany', () => {
    const OTHER_JOB_ID = randomUUID();

    it('Every bulk job is queued', async () => {
      await expect(
        queue.enqueueMany({
          entries: [entry(JOB_ID, 1), entry(OTHER_JOB_ID, 1)],
        }),
      ).resolves.toEqual({});

      expect(await observer.getJobCountByTypes('waiting', 'prioritized')).toBe(2);
      for (const jobId of [JOB_ID, OTHER_JOB_ID]) {
        const queued = await observer.getJob(JobQueueEntryId.encode({ jobId, attempt: 1 }));
        expect(queued?.data).toEqual({ jobId });
      }
    });

    it('does not add an entry that is already on the queue a second time', async () => {
      await queue.enqueue(entry(JOB_ID, 1));

      await queue.enqueueMany({
        entries: [entry(JOB_ID, 1), entry(OTHER_JOB_ID, 1)],
      });

      expect(await observer.getJobCountByTypes('waiting', 'prioritized')).toBe(2);
    });

    it('adds one entry when the same attempt appears twice in one call', async () => {
      await queue.enqueueMany({
        entries: [entry(JOB_ID, 1), entry(JOB_ID, 1)],
      });

      expect(await observer.getJobCountByTypes('waiting', 'prioritized')).toBe(1);
    });

    it('rejects at once, names every entry and logs the job ids while Redis cannot be reached', async () => {
      const warn = vi.fn();
      const unreachable = new BullMqJobQueue(
        { logger: { warn }, clock },
        { redisUrl: UNREACHABLE_REDIS_URL, enqueueTimeoutMs: ENQUEUE_TIMEOUT_MS },
      );
      const entries = [entry(JOB_ID, 1), entry(OTHER_JOB_ID, 1)];
      const startedAt = performance.now();
      try {
        const error: unknown = await unreachable
          .enqueueMany({ entries })
          .catch((err: unknown) => err);

        expect(error).toBeInstanceOf(JobQueueUnavailableError);
        expect((error as JobQueueUnavailableError).details).toEqual({
          entries: entries.map(({ jobId, attempt }) => ({ jobId, attempt })),
        });
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
      const entries = [entry(JOB_ID, 1), entry(OTHER_JOB_ID, 1)];
      await pauseWrites();
      const startedAt = performance.now();
      try {
        const error: unknown = await queue.enqueueMany({ entries }).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(JobQueueUnavailableError);
        expect((error as JobQueueUnavailableError).details).toEqual({
          entries: entries.map(({ jobId, attempt }) => ({ jobId, attempt })),
        });
        expect(performance.now() - startedAt).toBeGreaterThanOrEqual(ENQUEUE_TIMEOUT_MS - 1);
        expect(performance.now() - startedAt).toBeLessThan(ENQUEUE_TIMEOUT_MS * 4);
      } finally {
        await unpauseWrites();
      }

      await vi.waitFor(async () => {
        expect(await observer.getJobCountByTypes('waiting', 'prioritized')).toBe(2);
      });
    });
  });

  describe('order and time', () => {
    const LOW = randomUUID();
    const DEFAULT = randomUUID();
    const HIGH = randomUUID();
    const { min, max } = JOB_LIMITS.priority;

    it('High priority overtakes earlier low priority', async () => {
      await queue.enqueue(entry(LOW, 1, { priority: min }));
      await queue.enqueue(entry(HIGH, 1, { priority: max }));

      expect(await takeAll(3)).toEqual([HIGH, LOW, undefined]);
    });

    it('Priorities are taken highest first', async () => {
      await queue.enqueue(entry(LOW, 1, { priority: min }));
      await queue.enqueue(entry(DEFAULT, 1));
      await queue.enqueue(entry(HIGH, 1, { priority: max }));

      expect(await takeAll(3)).toEqual([HIGH, DEFAULT, LOW]);
    });

    it('Priorities are taken highest first from one bulk', async () => {
      await queue.enqueueMany({
        entries: [
          entry(LOW, 1, { priority: min }),
          entry(DEFAULT, 1),
          entry(HIGH, 1, { priority: max }),
        ],
      });

      expect(await takeAll(3)).toEqual([HIGH, DEFAULT, LOW]);
    });

    it('Same priority, first in first out', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const jobId of ids) await queue.enqueue(entry(jobId, 1, { priority: max }));

      expect(await takeAll(3)).toEqual(ids);
    });

    it('Same priority, first in first out within one bulk', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await queue.enqueueMany({ entries: ids.map((jobId) => entry(jobId, 1)) });

      expect(await takeAll(3)).toEqual(ids);
    });

    it('Scheduled job is queued for its time', async () => {
      clock.now.mockReturnValueOnce({ now: NOW });
      await queue.enqueue(entry(HIGH, 1, { priority: max, runAt: inMs(DELAY_MS) }));

      expect(await takeNext()).toBeUndefined();
      expect(await observer.getJobCountByTypes('delayed')).toBe(1);
      expect(
        (await observer.getJob(JobQueueEntryId.encode({ jobId: HIGH, attempt: 1 })))?.delay,
      ).toBe(DELAY_MS);
      expect(clock.now).toHaveBeenCalledOnce();
      await vi.waitFor(
        async () => {
          expect(await takeNext()).toBe(HIGH);
        },
        {
          timeout: DELAY_MS * 4,
          interval: 100,
        },
      );
    });

    it('Scheduled job of a bulk is queued for its time', async () => {
      clock.now.mockReturnValueOnce({ now: NOW });
      await queue.enqueueMany({
        entries: [entry(HIGH, 1, { runAt: inMs(DELAY_MS) }), entry(LOW, 1)],
      });

      expect(await takeAll(2)).toEqual([LOW, undefined]);
      expect(
        (await observer.getJob(JobQueueEntryId.encode({ jobId: HIGH, attempt: 1 })))?.delay,
      ).toBe(DELAY_MS);
      expect(clock.now).toHaveBeenCalledOnce();
      await vi.waitFor(
        async () => {
          expect(await takeNext()).toBe(HIGH);
        },
        {
          timeout: DELAY_MS * 4,
          interval: 100,
        },
      );
    });

    it('treats a runAt that is not in the future as available at once', async () => {
      clock.now.mockReturnValueOnce({ now: NOW });
      await queue.enqueue(entry(HIGH, 1, { runAt: inMs(-DELAY_MS) }));

      expect(await takeNext()).toBe(HIGH);
    });

    // The due entry sits between the waiting ones, so it must keep its priority to land in the
    // middle: an entry without one would be handed out before every prioritised entry.
    it('Due scheduled job competes by priority', async () => {
      clock.now.mockReturnValueOnce({ now: NOW });
      await queue.enqueue(entry(DEFAULT, 1, { runAt: inMs(DELAY_MS) }));
      await queue.enqueue(entry(LOW, 1, { priority: min }));
      await queue.enqueue(entry(HIGH, 1, { priority: max }));

      await sleep(DELAY_MS + 200);

      expect(await takeAll(3)).toEqual([HIGH, DEFAULT, LOW]);
    });

    it('Due scheduled job of a bulk competes by priority', async () => {
      clock.now.mockReturnValueOnce({ now: NOW });
      await queue.enqueueMany({
        entries: [
          entry(DEFAULT, 1, { runAt: inMs(DELAY_MS) }),
          entry(LOW, 1, { priority: min }),
          entry(HIGH, 1, { priority: max }),
        ],
      });

      await sleep(DELAY_MS + 200);

      expect(await takeAll(3)).toEqual([HIGH, DEFAULT, LOW]);
    });
  });
});
