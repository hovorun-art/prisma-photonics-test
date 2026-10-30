import {
  JOB_CANCELLATIONS_CHANNEL,
  JOB_LIMITS,
  JOB_QUEUE_NAME,
  JobQueueEntryId,
  type JobCancellationMessage,
  type JobQueueMessage,
} from '@job-queue/contracts';
import type { Clock, CloseClosableResponse } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
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
  /** The time an entry's delay is counted from. */
  clock: Clock;
}

interface WithinSignalRequest {
  work: Promise<unknown>;
  signal: AbortSignal;
}

interface OptionsRequest {
  entry: EnqueueJobQueueRequest;
  now: Date | null;
}

export interface BullMqJobQueueParams {
  redisUrl: string;
  /** How long `enqueue`, `enqueueMany` and `cancel` wait for Redis before they give up. */
  enqueueTimeoutMs: number;
}

/**
 * The job queue on BullMQ. Each attempt is one entry whose BullMQ id is `<jobId>_<run>_<attempt>`
 * (BullMQ rejects `:` in custom ids), so a repeated enqueue of the same attempt is ignored. The
 * entry carries only the job id. Order and time are BullMQ's: every entry gets a BullMQ priority
 * (1 is its most urgent, so our scale is turned around; an entry without one would overtake all
 * prioritised entries), and an entry with a future `runAt` is a delayed entry until then.
 * Cancellations are published on a Redis channel through a connection of their own (BullMQ's
 * client offers no `publish`). Commands are not buffered while Redis is down
 * (`enableOfflineQueue: false`), and every call is bounded by the configured timeout.
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
    try {
      await this.withinTimeout(
        this.queue.add(
          this.entryId(req),
          { jobId: req.jobId },
          this.options({ entry: req, now: this.now(req) }),
        ),
      );
    } catch (err) {
      this.d.logger.warn({ err, ...attempt }, 'Enqueue failed');
      throw new JobQueueUnavailableError(attempt);
    }
    return {};
  }

  /** One `addBulk`: BullMQ sends all entries in one Redis transaction, so all are added or none. */
  async enqueueMany(req: EnqueueManyJobQueueRequest): Promise<EnqueueManyJobQueueResponse> {
    const now = req.entries.some((entry) => entry.runAt !== null) ? this.d.clock.now().now : null;
    const entries = req.entries.map((entry) => ({
      name: this.entryId(entry),
      data: { jobId: entry.jobId },
      opts: this.options({ entry, now }),
    }));
    try {
      await this.withinTimeout(this.queue.addBulk(entries));
    } catch (err) {
      this.d.logger.warn(
        { err, jobIds: req.entries.map((entry) => entry.jobId) },
        'Bulk enqueue failed',
      );
      throw new JobQueueUnavailableError({
        entries: req.entries.map(({ jobId, run, attempt }) => ({ jobId, run, attempt })),
      });
    }
    return {};
  }

  async cancel(req: CancelJobQueueRequest): Promise<CancelJobQueueResponse> {
    const message: JobCancellationMessage = { jobId: req.jobId };
    const timeout = AbortSignal.timeout(this.p.enqueueTimeoutMs);
    try {
      // Never sent once the timeout has passed: a late announcement could stop a later run of the
      // same job (a retry) on a worker.
      await this.publisherReady(timeout);
      await this.withinSignal({
        work: this.publisher.publish(JOB_CANCELLATIONS_CHANNEL, JSON.stringify(message)),
        signal: timeout,
      });
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

  /** BullMQ's id, priority and delay for one entry; `now` is only needed for a `runAt`. */
  private options({ entry, now }: OptionsRequest): JobsOptions {
    const delay =
      entry.runAt === null || now === null
        ? 0
        : Math.max(0, new Date(entry.runAt).getTime() - now.getTime());
    return {
      jobId: this.entryId(entry),
      priority: JOB_LIMITS.priority.max + 1 - entry.priority,
      ...(delay > 0 ? { delay } : {}),
    };
  }

  private entryId(entry: EnqueueJobQueueRequest): string {
    return JobQueueEntryId.encode({ jobId: entry.jobId, run: entry.run, attempt: entry.attempt });
  }

  /** The clock is read only for an entry with a `runAt`. */
  private now(entry: EnqueueJobQueueRequest): Date | null {
    return entry.runAt === null ? null : this.d.clock.now().now;
  }

  /** Rejects when `work` has not settled within the configured enqueue timeout. */
  private async withinTimeout(work: Promise<unknown>): Promise<void> {
    await this.withinSignal({ work, signal: AbortSignal.timeout(this.p.enqueueTimeoutMs) });
  }

  /** Rejects when `signal` aborts before `work` has settled. */
  private async withinSignal({ work, signal }: WithinSignalRequest): Promise<void> {
    signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(signal.reason as Error);
      });
    });
    await Promise.race([work, aborted]);
  }

  /**
   * Resolves once the publisher's connection is ready, at once when it is; rejects when `signal`
   * aborts first. Its commands are not buffered (`enableOfflineQueue: false`), so a publish sent
   * before then (just after start, or while it reconnects) would be refused.
   */
  private publisherReady(signal: AbortSignal): Promise<void> {
    if (this.publisher.status === 'ready') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => {
        this.publisher.off('ready', onReady);
        reject(signal.reason as Error);
      };
      this.publisher.once('ready', onReady);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
