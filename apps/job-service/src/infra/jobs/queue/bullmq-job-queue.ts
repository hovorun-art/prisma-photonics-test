import { JOB_QUEUE_NAME, type JobQueueMessage } from '@job-queue/contracts';
import type { CloseClosableResponse } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { Queue } from 'bullmq';

import { JobQueueUnavailableError } from '../../../domain/jobs/errors/job-queue-unavailable.error.js';
import type {
  EnqueueJobQueueRequest,
  EnqueueJobQueueResponse,
  JobQueue,
} from '../../../domain/jobs/job-queue.js';

export interface BullMqJobQueueDeps {
  logger: Pick<LoggerService, 'warn'>;
}

export interface BullMqJobQueueParams {
  redisUrl: string;
  /** How long `enqueue` waits for Redis before it gives up. */
  enqueueTimeoutMs: number;
}

/**
 * The job queue on BullMQ. Each attempt is one entry whose BullMQ id is `<jobId>_<attempt>`
 * (BullMQ rejects `:` in custom ids), so a repeated enqueue of the same attempt is ignored. The
 * entry carries only the job id. Commands are not buffered while Redis is down
 * (`enableOfflineQueue: false`), and every enqueue is bounded by the configured timeout.
 */
export class BullMqJobQueue implements JobQueue {
  private readonly queue: Queue<JobQueueMessage>;

  constructor(
    private readonly d: BullMqJobQueueDeps,
    private readonly p: BullMqJobQueueParams,
  ) {
    this.queue = new Queue<JobQueueMessage>(JOB_QUEUE_NAME, {
      connection: {
        url: p.redisUrl,
        enableOfflineQueue: false,
        connectionName: 'job-service-queue',
      },
    });
    // Without a listener a Redis outage would surface as an unhandled 'error' event.
    this.queue.on('error', (err: unknown) => {
      this.d.logger.warn({ err }, 'Job queue connection error');
    });
  }

  async enqueue(req: EnqueueJobQueueRequest): Promise<EnqueueJobQueueResponse> {
    const entryId = `${req.jobId}_${req.attempt}`;
    const timeout = AbortSignal.timeout(this.p.enqueueTimeoutMs);
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout.addEventListener('abort', () => {
        reject(timeout.reason as Error);
      });
    });
    try {
      await Promise.race([
        this.queue.add(entryId, { jobId: req.jobId }, { jobId: entryId }),
        timedOut,
      ]);
    } catch (err) {
      this.d.logger.warn({ err, jobId: req.jobId, attempt: req.attempt }, 'Enqueue failed');
      throw new JobQueueUnavailableError({ jobId: req.jobId, attempt: req.attempt });
    }
    return {};
  }

  async close(): Promise<CloseClosableResponse> {
    await this.queue.close();
    return {};
  }
}
