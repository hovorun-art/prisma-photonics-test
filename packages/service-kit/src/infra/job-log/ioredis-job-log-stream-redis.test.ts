import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobLogStreamUnavailableError } from '../../domain/job-log/errors/job-log-stream-unavailable.error.js';
import { IoRedisJobLogStreamRedis } from './ioredis-job-log-stream-redis.js';

const client = vi.hoisted(() => ({
  status: 'connecting',
  on: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
}));
const Redis = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({ Redis }));

describe('IoRedisJobLogStreamRedis', () => {
  const create = () =>
    new IoRedisJobLogStreamRedis({
      redisUrl: 'redis://localhost:6379',
      connectionName: 'a-service-job-log',
      openTimeoutMs: 50,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    Redis.mockImplementationOnce(function () {
      return client;
    });
    client.status = 'connecting';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('open rejects when the connection is not ready in time, and stops listening for it', async () => {
    const opening = create().open();
    const rejection = expect(opening).rejects.toEqual(
      new JobLogStreamUnavailableError({ openTimeoutMs: 50 }),
    );

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    const listener = client.once.mock.calls[0]?.[1] as unknown;
    expect(client.once).toHaveBeenCalledExactlyOnceWith('ready', listener);
    expect(client.off).toHaveBeenCalledExactlyOnceWith('ready', listener);
  });

  it('open resolves at once when the connection is ready', async () => {
    client.status = 'ready';

    await expect(create().open()).resolves.toEqual({});
    expect(client.once).not.toHaveBeenCalled();
  });

  it('open resolves when the connection becomes ready in time', async () => {
    const opening = create().open();
    const listener = client.once.mock.calls[0]?.[1] as () => void;

    listener();

    await expect(opening).resolves.toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });
});
