import type { Closable, CloseClosableResponse } from '@job-queue/kernel';
import { Redis, type RedisOptions } from 'ioredis';

export interface IoRedisClientParams {
  redisUrl: string;
  /** Name of the connection in Redis `CLIENT LIST`. */
  connectionName: string;
  /** How many times a command is retried before it rejects; 0 rejects at once. */
  maxRetriesPerRequest: number;
  /** Whether commands wait for the connection; ioredis default (on) when omitted. */
  enableOfflineQueue?: boolean;
  /** Connect with the first command instead of at construction. */
  lazyConnect?: boolean;
  /** Receives every connection error; without a listener ioredis prints each of them. */
  onError: (err: unknown) => void;
}

/**
 * The one place an ioredis connection is built and closed. The users take the connection from
 * `redis` and choose its options and what happens to its errors.
 */
export class IoRedisClient implements Closable {
  readonly redis: Redis;

  constructor(p: IoRedisClientParams) {
    const options: RedisOptions = {
      connectionName: p.connectionName,
      maxRetriesPerRequest: p.maxRetriesPerRequest,
      ...(p.enableOfflineQueue === undefined ? {} : { enableOfflineQueue: p.enableOfflineQueue }),
      ...(p.lazyConnect === undefined ? {} : { lazyConnect: p.lazyConnect }),
    };
    this.redis = new Redis(p.redisUrl, options);
    this.redis.on('error', p.onError);
  }

  /** Sends QUIT when connected, so pending replies arrive first; otherwise stops reconnecting. */
  async close(): Promise<CloseClosableResponse> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
    return {};
  }
}
