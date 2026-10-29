import type { CloseClosableResponse } from '@job-queue/kernel';
import { Redis } from 'ioredis';

import type {
  CountRedisConnectionCounterRequest,
  CountRedisConnectionCounterResponse,
  RedisConnectionCounter,
} from '../domain/spawned-service.js';

export interface ClientListRedisConnectionCounterParams {
  redisUrl: string;
}

/** Counts connections with Redis `CLIENT LIST`, through a connection of its own. */
export class ClientListRedisConnectionCounter implements RedisConnectionCounter {
  private readonly observer: Redis;

  constructor(p: ClientListRedisConnectionCounterParams) {
    this.observer = new Redis(p.redisUrl);
  }

  async count(
    req: CountRedisConnectionCounterRequest,
  ): Promise<CountRedisConnectionCounterResponse> {
    const clients = String(await this.observer.client('LIST'));
    return {
      connections: clients.split('\n').filter((line) => line.includes(` name=${req.name} `)).length,
    };
  }

  async close(): Promise<CloseClosableResponse> {
    await this.observer.quit();
    return {};
  }
}
