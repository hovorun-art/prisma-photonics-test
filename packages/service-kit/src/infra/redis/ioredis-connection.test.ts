import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IoRedisConnection } from './ioredis-connection.js';

/** The ioredis client the connection built, as the tests drive it. */
const client = vi.hoisted(() => ({
  status: 'ready',
  ping: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));
const Redis = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({ Redis }));

describe('IoRedisConnection', () => {
  const logger = { warn: vi.fn() };
  const params = { redisUrl: 'redis://localhost:6379', connectionName: 'a-service' };
  const create = (awaitFirstAnswer: boolean) =>
    new IoRedisConnection({ logger }, { ...params, awaitFirstAnswer });

  beforeEach(() => {
    vi.resetAllMocks();
    Redis.mockImplementation(function () {
      return client;
    });
    client.status = 'ready';
    client.ping.mockResolvedValue('PONG');
    client.quit.mockResolvedValue('OK');
  });

  it('names the connection and fails each command after one retry', () => {
    create(false);

    expect(Redis.mock.calls[0]).toEqual([
      params.redisUrl,
      { connectionName: 'a-service', maxRetriesPerRequest: 1 },
    ]);
  });

  it('logs a connection error instead of throwing it', () => {
    create(false);
    const listener = client.on.mock.calls.find(([event]) => event === 'error')?.[1] as (
      err: unknown,
    ) => void;
    const err = new Error('ECONNREFUSED');

    listener(err);

    expect(logger.warn).toHaveBeenCalledWith({ err }, 'Redis connection error');
  });

  it('waits for the first answer when asked to', async () => {
    await create(true).start();

    expect(client.ping).toHaveBeenCalledOnce();
  });

  it('does not wait for Redis when not asked to', async () => {
    await create(false).start();

    expect(client.ping).not.toHaveBeenCalled();
  });

  it('stops reconnecting and rejects when Redis does not answer the first time', async () => {
    client.ping.mockRejectedValue(new Error('unreachable'));

    await expect(create(true).start()).rejects.toThrow('unreachable');
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('sends QUIT when connected, so pending replies arrive first', async () => {
    await create(false).close();

    expect(client.quit).toHaveBeenCalledOnce();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('stops reconnecting when it is not connected', async () => {
    client.status = 'reconnecting';

    await create(false).close();

    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(client.quit).not.toHaveBeenCalled();
  });
});
