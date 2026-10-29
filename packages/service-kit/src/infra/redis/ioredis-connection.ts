import type { CloseClosableResponse } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { Redis } from 'ioredis';

import type {
  PingRedisConnectionResponse,
  RedisConnection,
  StartRedisConnectionResponse,
} from '../../domain/redis/redis-connection.js';

export interface IoRedisConnectionDeps {
  logger: Pick<LoggerService, 'warn'>;
}

export interface IoRedisConnectionParams {
  redisUrl: string;
  /** Name of the connection in Redis `CLIENT LIST`. */
  connectionName: string;
  /** `start()` waits for Redis to answer; otherwise the connection is made in the background. */
  awaitFirstAnswer: boolean;
}

/**
 * The ioredis implementation: each command fails after one retry, and a connection error is
 * logged, never thrown (an outage must not crash the app).
 */
export class IoRedisConnection implements RedisConnection {
  private readonly redis: Redis;

  constructor(
    private readonly d: IoRedisConnectionDeps,
    private readonly p: IoRedisConnectionParams,
  ) {
    this.redis = new Redis(p.redisUrl, {
      connectionName: p.connectionName,
      maxRetriesPerRequest: 1,
    });
    // Without a listener ioredis prints every connection error.
    this.redis.on('error', (err: unknown) => {
      this.d.logger.warn({ err }, 'Redis connection error');
    });
  }

  async start(): Promise<StartRedisConnectionResponse> {
    if (this.p.awaitFirstAnswer) {
      try {
        await this.ping();
      } catch (error) {
        this.redis.disconnect();
        throw error;
      }
    }
    return {};
  }

  async ping(): Promise<PingRedisConnectionResponse> {
    await this.redis.ping();
    return {};
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
