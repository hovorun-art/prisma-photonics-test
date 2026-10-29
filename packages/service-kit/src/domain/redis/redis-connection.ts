import type { Closable } from '@job-queue/kernel';

/** Token for a service's one Redis connection. */
export const REDIS_CONNECTION = Symbol('RedisConnection');

/** A service's connection to Redis. It reconnects on its own while Redis is down. */
export interface RedisConnection extends Closable {
  /**
   * Resolves once Redis has answered; when it does not (the connection fails), rejects and stops
   * reconnecting. Without waiting for the first answer it resolves at once.
   */
  start(): Promise<StartRedisConnectionResponse>;
  /** Fails after one retry instead of waiting forever while Redis is down. */
  ping(): Promise<PingRedisConnectionResponse>;
}

export type StartRedisConnectionResponse = Record<string, never>;
export type PingRedisConnectionResponse = Record<string, never>;
