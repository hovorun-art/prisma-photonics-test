import type { CloseClosableResponse } from '@job-queue/kernel';

import type {
  AppendJobLogStreamRedisRequest,
  AppendJobLogStreamRedisResponse,
  OpenJobLogStreamRedisResponse,
  JobLogStreamRedis,
} from '../../domain/job-log/job-log-stream-redis.js';
import { IoRedisClient } from '../redis/ioredis-client.js';
import { JobLogStreamUnavailableError } from '../../domain/job-log/errors/job-log-stream-unavailable.error.js';

export interface IoRedisJobLogStreamRedisParams {
  redisUrl: string;
  /** Name of the connection in Redis `CLIENT LIST`. */
  connectionName: string;
  /** How long `open()` waits for the connection to be ready before it rejects. */
  openTimeoutMs: number;
}

/** The ioredis implementation: no offline queue, no per-command retries. */
export class IoRedisJobLogStreamRedis implements JobLogStreamRedis {
  private readonly client: IoRedisClient;

  constructor(private readonly p: IoRedisJobLogStreamRedisParams) {
    this.client = new IoRedisClient({
      redisUrl: p.redisUrl,
      connectionName: p.connectionName,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      // Outages are reported per dropped entry.
      onError: () => undefined,
    });
  }

  async open(): Promise<OpenJobLogStreamRedisResponse> {
    if (this.client.redis.status === 'ready') return {};
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client.redis.off('ready', onReady);
        reject(new JobLogStreamUnavailableError({ openTimeoutMs: this.p.openTimeoutMs }));
      }, this.p.openTimeoutMs);
      const onReady = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.client.redis.once('ready', onReady);
    });
    return {};
  }

  async append(req: AppendJobLogStreamRedisRequest): Promise<AppendJobLogStreamRedisResponse> {
    await this.client.redis.xadd(req.stream, 'MAXLEN', '~', req.maxLength, '*', 'data', req.data);
    return {};
  }

  async close(): Promise<CloseClosableResponse> {
    return this.client.close();
  }
}
