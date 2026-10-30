import type { Closable } from '@job-queue/kernel';

/** Counts the connections a client has open under a name. */
export interface RedisConnectionCounter extends Closable {
  count(req: CountRedisConnectionCounterRequest): Promise<CountRedisConnectionCounterResponse>;
}

export interface CountRedisConnectionCounterRequest {
  /** The connection name (`CLIENT SETNAME`). */
  name: string;
}

export interface CountRedisConnectionCounterResponse {
  connections: number;
}
