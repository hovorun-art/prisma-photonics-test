import {
  JOB_CANCELLATIONS_CHANNEL,
  JOB_QUEUE_NAME,
  JobQueueEntryId,
  type JobCancellationMessage,
  type JobQueueMessage,
} from '@job-queue/contracts';
import type { CloseClosableResponse } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { JobQueueUnavailableError } from '../../../domain/jobs/errors/job-queue-unavailable.error.js';
import type {
  CancelJobQueueRequest,
  CancelJobQueueResponse,
  EnqueueJobQueueRequest,
  EnqueueJobQueueResponse,
  EnqueueManyJobQueueRequest,
  EnqueueManyJobQueueResponse,
  JobQueue,
} from '../../../domain/jobs/job-queue.js';

export interface BullMqJobQueueDeps {
  logger: Pick<LoggerService, 'warn'>;
}

export interface BullMqJobQueueParams {
  redisUrl: string;
  /** How long `enqueue`, `enqueueMany` and `cancel` wait for Redis before they give up. */
  enqueueTimeoutMs: number;
}

/**
 * The job queue on BullMQ. Each attempt is one entry whose BullMQ id is `<jobId>_<run>_<attempt>`
 * (BullMQ rejects `:` in custom ids), so a repeated enqueue of the same attempt is ignored. The
 * entry carries only the job id. Cancellations are published on a Redis channel through a
 * connection of their own (BullMQ's client offers no `publish`). Commands are not buffered while Redis is down
 * (`enableOfflineQueue: false`), and every enqueue is bounded by the configured timeout.
 */
export class BullMqJobQueue implements JobQueue {
  private readonly queue: Queue<JobQueueMessage>;
  private readonly publisher: Redis;

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
    this.publisher = new Redis(p.redisUrl, {
      enableOfflineQueue: false,
      connectionName: 'job-service-cancellations',
    });
    // Without a listener a Redis outage would surface as an unhandled 'error' event.
    this.queue.on('error', (err: unknown) => {
      this.d.logger.warn({ err }, 'Job queue connection error');
    });
    this.publisher.on('error', (err: unknown) => {
      this.d.logger.warn({ err }, 'Job cancellations connection error');
    });
  }

  async enqueue(req: EnqueueJobQueueRequest): Promise<EnqueueJobQueueResponse> {
    const attempt = { jobId: req.jobId, run: req.run, attempt: req.attempt };
    const entryId = JobQueueEntryId.encode(attempt);
    try {
      await this.withinTimeout(this.queue.add(entryId, { jobId: req.jobId }, { jobId: entryId }));
    } catch (err) {
      this.d.logger.warn({ err, ...attempt }, 'Enqueue failed');
      throw new JobQueueUnavailableError(attempt);
    }
    return {};
  }

  /** One `addBulk`: BullMQ sends all entries in one Redis transaction, so all are added or none. */
  async enqueueMany(req: EnqueueManyJobQueueRequest): Promise<EnqueueManyJobQueueResponse> {
    const entries = req.entries.map((entry) => {
      const entryId = JobQueueEntryId.encode({
        jobId: entry.jobId,
        run: entry.run,
        attempt: entry.attempt,
      });
      return { name: entryId, data: { jobId: entry.jobId }, opts: { jobId: entryId } };
    });
    try {
      await this.withinTimeout(this.queue.addBulk(entries));
    } catch (err) {
      this.d.logger.warn(
        { err, jobIds: req.entries.map((entry) => entry.jobId) },
        'Bulk enqueue failed',
      );
      throw new JobQueueUnavailableError({ entries: req.entries });
    }
    return {};
  }

  async cancel(req: CancelJobQueueRequest): Promise<CancelJobQueueResponse> {
    const message: JobCancellationMessage = { jobId: req.jobId };
    try {
      await this.withinTimeout(
        this.publisher.publish(JOB_CANCELLATIONS_CHANNEL, JSON.stringify(message)),
      );
    } catch (err) {
      this.d.logger.warn({ err, jobId: req.jobId }, 'Cancellation could not be announced');
      throw new JobQueueUnavailableError({ cancelledJobId: req.jobId });
    }
    return {};
  }

  async close(): Promise<CloseClosableResponse> {
    await this.queue.close();
    this.publisher.disconnect();
    return {};
  }

  /** Rejects when `work` has not settled within the configured enqueue timeout. */
  private async withinTimeout(work: Promise<unknown>): Promise<void> {
    const timeout = AbortSignal.timeout(this.p.enqueueTimeoutMs);
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout.addEventListener('abort', () => {
        reject(timeout.reason as Error);
      });
    });
    await Promise.race([work, timedOut]);
  }
}
