import { randomUUID } from 'node:crypto';

import { JOB_CANCELLATIONS_CHANNEL } from '@job-queue/contracts';
import {
  CONTAINER_IMAGES,
  ClientListRedisConnectionCounter,
  UNREACHABLE_REDIS_URL,
} from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { type Mock, afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RedisJobCancellations } from './redis-job-cancellations.js';

const JOB_ID = randomUUID();
const OTHER_JOB_ID = randomUUID();
const CONNECTION_NAME = 'job-execution-service-cancellations';

describe('RedisJobCancellations against Redis', () => {
  let container: StartedRedisContainer;
  let publisher: Redis;
  let counter: ClientListRedisConnectionCounter;
  let cancellations: RedisJobCancellations | undefined;
  let warn: Mock<(message: unknown, context?: string) => void>;

  const connections = async (): Promise<number> =>
    (await counter.count({ name: CONNECTION_NAME })).connections;

  /** Starts listening and collects the ids it is told about. */
  const listening = async (): Promise<string[]> => {
    const cancelled: string[] = [];
    warn = vi.fn<(message: unknown, context?: string) => void>();
    cancellations = new RedisJobCancellations(
      { logger: { warn } },
      { redisUrl: container.getConnectionUrl() },
    );
    await expect(
      cancellations.listen({
        onCancel: (jobId) => {
          cancelled.push(jobId);
        },
      }),
    ).resolves.toEqual({});
    return cancelled;
  };

  beforeAll(async () => {
    container = await new RedisContainer(CONTAINER_IMAGES.redis).start();
    publisher = new Redis(container.getConnectionUrl());
    counter = new ClientListRedisConnectionCounter({ redisUrl: container.getConnectionUrl() });
  });
  afterEach(async () => {
    await cancellations?.close();
    cancellations = undefined;
    // Redis drops a closed connection from its list a moment later; the next test counts from zero.
    await vi.waitFor(async () => {
      expect(await connections()).toBe(0);
    });
  });
  afterAll(async () => {
    await counter.close();
    await publisher.quit();
    await container.stop();
  });

  it('hands each announced job id to onCancel, in order', async () => {
    const cancelled = await listening();

    await publisher.publish(JOB_CANCELLATIONS_CHANNEL, JSON.stringify({ jobId: JOB_ID }));
    await publisher.publish(JOB_CANCELLATIONS_CHANNEL, JSON.stringify({ jobId: OTHER_JOB_ID }));

    await vi.waitFor(() => {
      expect(cancelled).toEqual([JOB_ID, OTHER_JOB_ID]);
    });
  });

  it('ignores malformed announcements with a warning and keeps listening', async () => {
    const cancelled = await listening();

    for (const message of ['not json', JSON.stringify({ jobId: 'abc' }), JSON.stringify({})]) {
      await publisher.publish(JOB_CANCELLATIONS_CHANNEL, message);
    }
    await publisher.publish(JOB_CANCELLATIONS_CHANNEL, JSON.stringify({ jobId: JOB_ID }));

    await vi.waitFor(() => {
      expect(cancelled).toEqual([JOB_ID]);
    });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'not json' }),
      'Ignored a malformed job cancellation',
    );
  });

  it('ignores messages on other channels', async () => {
    const cancelled = await listening();

    await publisher.publish('other-channel', JSON.stringify({ jobId: OTHER_JOB_ID }));
    await publisher.publish(JOB_CANCELLATIONS_CHANNEL, JSON.stringify({ jobId: JOB_ID }));

    await vi.waitFor(() => {
      expect(cancelled).toEqual([JOB_ID]);
    });
  });

  it('listens again after its connection was dropped', async () => {
    const cancelled = await listening();

    await publisher.call('CLIENT', 'KILL', 'TYPE', 'pubsub');

    // Published until heard: the subscriber reconnects and subscribes again on its own.
    await vi.waitFor(
      async () => {
        await publisher.publish(JOB_CANCELLATIONS_CHANNEL, JSON.stringify({ jobId: JOB_ID }));
        expect(cancelled).toContain(JOB_ID);
      },
      { timeout: 10_000, interval: 200 },
    );
  });

  it('logs a warning, and raises no unhandled error, while Redis cannot be reached', async () => {
    const unreachableWarn = vi.fn<(message: unknown, context?: string) => void>();
    const unreachable = new RedisJobCancellations(
      { logger: { warn: unreachableWarn } },
      { redisUrl: UNREACHABLE_REDIS_URL },
    );
    // Never settles while Redis is away (the subscription waits for it), so it is not awaited,
    // just as the app does not await it at bootstrap.
    void unreachable.listen({ onCancel: () => undefined }).catch(() => undefined);
    try {
      await vi.waitFor(() => {
        expect(unreachableWarn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.anything() as unknown }),
          'Job cancellations connection error',
        );
      });
    } finally {
      await unreachable.close();
    }
  });

  it('opens one named connection and closes it once', async () => {
    await listening();
    expect(await connections()).toBe(1);

    await cancellations?.close();
    cancellations = undefined;

    await vi.waitFor(async () => {
      expect(await connections()).toBe(0);
    });
  });
});
