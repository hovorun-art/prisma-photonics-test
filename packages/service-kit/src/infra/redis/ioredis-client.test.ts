import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IoRedisClient } from './ioredis-client.js';

const client = vi.hoisted(() => ({
  status: 'ready',
  quit: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));
const Redis = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({ Redis }));

describe('IoRedisClient', () => {
  const onError = vi.fn();
  const redisUrl = 'redis://localhost:6379';

  beforeEach(() => {
    vi.resetAllMocks();
    Redis.mockImplementationOnce(function () {
      return client;
    });
    client.status = 'ready';
  });

  it('connects with the given name and options', () => {
    new IoRedisClient({
      redisUrl,
      connectionName: 'a-service',
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      lazyConnect: true,
      onError,
    });

    expect(Redis).toHaveBeenCalledExactlyOnceWith(redisUrl, {
      connectionName: 'a-service',
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  });

  it('leaves out the options that are not given', () => {
    new IoRedisClient({ redisUrl, connectionName: 'a-service', maxRetriesPerRequest: 1, onError });

    expect(Redis).toHaveBeenCalledExactlyOnceWith(redisUrl, {
      connectionName: 'a-service',
      maxRetriesPerRequest: 1,
    });
  });

  it('hands a connection error to the given handler instead of throwing it', () => {
    new IoRedisClient({ redisUrl, connectionName: 'a-service', maxRetriesPerRequest: 1, onError });
    const listener = client.on.mock.calls.find(([event]) => event === 'error')?.[1] as (
      err: unknown,
    ) => void;
    const err = new Error('ECONNREFUSED');

    listener(err);

    expect(onError).toHaveBeenCalledExactlyOnceWith(err);
  });

  it('closes with QUIT when ready', async () => {
    client.quit.mockResolvedValueOnce('OK');

    await new IoRedisClient({
      redisUrl,
      connectionName: 'a-service',
      maxRetriesPerRequest: 1,
      onError,
    }).close();

    expect(client.quit).toHaveBeenCalledOnce();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('passes on the rejection when QUIT fails while ready', async () => {
    const failure = new Error('connection lost');
    client.quit.mockRejectedValueOnce(failure);

    await expect(
      new IoRedisClient({
        redisUrl,
        connectionName: 'a-service',
        maxRetriesPerRequest: 1,
        onError,
      }).close(),
    ).rejects.toBe(failure);
  });

  it('disconnects when not ready', async () => {
    client.status = 'connecting';

    await new IoRedisClient({
      redisUrl,
      connectionName: 'a-service',
      maxRetriesPerRequest: 1,
      onError,
    }).close();

    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(client.quit).not.toHaveBeenCalled();
  });
});
