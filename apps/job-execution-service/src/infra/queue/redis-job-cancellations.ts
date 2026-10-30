import { JOB_CANCELLATIONS_CHANNEL, JobCancellationMessage } from '@job-queue/contracts';
import type { CloseClosableResponse } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { Redis } from 'ioredis';

import type {
  JobCancellations,
  ListenJobCancellationsRequest,
  ListenJobCancellationsResponse,
} from '../../domain/queue/job-cancellations.js';

export interface RedisJobCancellationsDeps {
  logger: Pick<LoggerService, 'warn'>;
}

export interface RedisJobCancellationsParams {
  redisUrl: string;
}

/**
 * The cancellations job-service publishes on a Redis channel. A subscribing connection can run no
 * other commands, so it is a connection of its own; ioredis subscribes again after a reconnect.
 * Messages are checked against the shared contract; a malformed one is logged and ignored.
 */
export class RedisJobCancellations implements JobCancellations {
  private readonly subscriber: Redis;

  constructor(
    private readonly d: RedisJobCancellationsDeps,
    p: RedisJobCancellationsParams,
  ) {
    this.subscriber = new Redis(p.redisUrl, {
      connectionName: 'job-execution-service-cancellations',
      lazyConnect: true,
    });
    // Without a listener a Redis outage would surface as an unhandled 'error' event.
    this.subscriber.on('error', (err: unknown) => {
      this.d.logger.warn({ err }, 'Job cancellations connection error');
    });
  }

  async listen(req: ListenJobCancellationsRequest): Promise<ListenJobCancellationsResponse> {
    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel !== JOB_CANCELLATIONS_CHANNEL) return;
      const jobId = this.toJobId(message);
      if (jobId !== undefined) req.onCancel(jobId);
    });
    await this.subscriber.subscribe(JOB_CANCELLATIONS_CHANNEL);
    return {};
  }

  close(): Promise<CloseClosableResponse> {
    this.subscriber.disconnect();
    return Promise.resolve({});
  }

  private toJobId(message: string): string | undefined {
    try {
      return JobCancellationMessage.parse(JSON.parse(message)).jobId;
    } catch (err) {
      this.d.logger.warn({ err, message }, 'Ignored a malformed job cancellation');
      return undefined;
    }
  }
}
