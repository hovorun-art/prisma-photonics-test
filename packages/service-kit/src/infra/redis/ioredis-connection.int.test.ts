import { ClientListRedisConnectionCounter, CONTAINER_IMAGES } from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { IoRedisConnection } from './ioredis-connection.js';

const CONNECTION_NAME = 'ioredis-connection-int-test';
const POLL = { timeout: 10_000, interval: 100 };

describe('IoRedisConnection against Redis', () => {
  let container: StartedRedisContainer;
  let counter: ClientListRedisConnectionCounter;

  beforeAll(async () => {
    container = await new RedisContainer(CONTAINER_IMAGES.redis).start();
    counter = new ClientListRedisConnectionCounter({ redisUrl: container.getConnectionUrl() });
  });
  afterAll(async () => {
    await counter.close();
    await container.stop();
  });

  it('connects under its name, answers a ping and quits', async () => {
    const connection = new IoRedisConnection(
      { logger: { warn: vi.fn() } },
      {
        redisUrl: container.getConnectionUrl(),
        connectionName: CONNECTION_NAME,
        awaitFirstAnswer: true,
      },
    );

    await connection.start();
    await expect(connection.ping()).resolves.toEqual({});
    await expect
      .poll(async () => (await counter.count({ name: CONNECTION_NAME })).connections, POLL)
      .toBe(1);

    await connection.close();

    await expect
      .poll(async () => (await counter.count({ name: CONNECTION_NAME })).connections, POLL)
      .toBe(0);
  });
});
