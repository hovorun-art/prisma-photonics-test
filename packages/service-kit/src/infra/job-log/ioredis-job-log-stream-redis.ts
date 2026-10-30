import type { CloseClosableResponse } from '@job-queue/kernel';
import { Redis } from 'ioredis';

import type {
  AppendJobLogStreamRedisRequest,
  AppendJobLogStreamRedisResponse,
  OpenJobLogStreamRedisResponse,
  JobLogStreamRedis,
} from '../../domain/job-log/job-log-stream-redis.js';

export interface IoRedisJobLogStreamRedisParams {
  redisUrl: string;
  /** Name of the connection in Redis `CLIENT LIST`. */
  connectionName: string;
  /** How long `open()` waits for the connection to be ready before it rejects. */
  openTimeoutMs: number;
}

/** The ioredis implementation: no offline queue, no per-command retries. */
export class IoRedisJobLogStreamRedis implements JobLogStreamRedis {
  private readonly redis: Redis;

  constructor(private readonly p: IoRedisJobLogStreamRedisParams) {
    this.redis = new Redis(p.redisUrl, {
      connectionName: p.connectionName,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    // Outages are reported per dropped entry; without a listener ioredis prints every error.
    this.redis.on('error', () => undefined);
  }

  async open(): Promise<OpenJobLogStreamRedisResponse> {
    if (this.redis.status === 'ready') return {};
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.redis.off('ready', onReady);
        reject(new Error(`Job log Redis connection not ready within ${this.p.openTimeoutMs} ms`));
      }, this.p.openTimeoutMs);
      const onReady = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.redis.once('ready', onReady);
    });
    return {};
  }

  async append(req: AppendJobLogStreamRedisRequest): Promise<AppendJobLogStreamRedisResponse> {
    await this.redis.xadd(req.stream, 'MAXLEN', '~', req.maxLength, '*', 'data', req.data);
    return {};
  }

  async close(): Promise<CloseClosableResponse> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
    return {};
  }
}
