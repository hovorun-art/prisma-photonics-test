import {
  JOB_LIMITS,
  JOB_QUEUE_NAME,
  JobQueueEntryId,
  type JobQueueMessage,
} from '@job-queue/contracts';
import type { Clock, CloseClosableResponse } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { JobQueueUnavailableError } from '../../../domain/jobs/errors/job-queue-unavailable.error.js';
import type {
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

interface OptionsRequest {
  entry: EnqueueJobQueueRequest;
  now: Date | null;
}

export interface BullMqJobQueueParams {
  redisUrl: string;
  /** How long `enqueue` waits for Redis before it gives up. */
  enqueueTimeoutMs: number;
}

/**
 * The job queue on BullMQ. Each attempt is one entry whose BullMQ id is `<jobId>_<attempt>`
 * (BullMQ rejects `:` in custom ids), so a repeated enqueue of the same attempt is ignored. The
 * entry carries only the job id. Order and time are BullMQ's: every entry gets a BullMQ priority
 * (1 is its most urgent, so our scale is turned around; an entry without one would overtake all
 * prioritised entries), and an entry with a future `runAt` is a delayed entry until then. Commands
 * are not buffered while Redis is down (`enableOfflineQueue: false`), and every enqueue is bounded
 * by the configured timeout.
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
    const entryId = JobQueueEntryId.encode({ jobId: req.jobId, attempt: req.attempt });
    try {
      await this.withinTimeout(
        this.queue.add(
          entryId,
          { jobId: req.jobId },
          this.options({ entry: req, now: this.now(req) }),
        ),
      );
    } catch (err) {
      this.d.logger.warn({ err, jobId: req.jobId, attempt: req.attempt }, 'Enqueue failed');
      throw new JobQueueUnavailableError({ jobId: req.jobId, attempt: req.attempt });
    }
    return {};
  }

  /** One `addBulk`: BullMQ sends all entries in one Redis transaction, so all are added or none. */
  async enqueueMany(req: EnqueueManyJobQueueRequest): Promise<EnqueueManyJobQueueResponse> {
    const now = req.entries.some((entry) => entry.runAt !== null) ? this.d.clock.now().now : null;
    const entries = req.entries.map((entry) => ({
      name: JobQueueEntryId.encode({ jobId: entry.jobId, attempt: entry.attempt }),
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
        entries: req.entries.map(({ jobId, attempt }) => ({ jobId, attempt })),
      });
    }
    return {};
  }

  async close(): Promise<CloseClosableResponse> {
    await this.queue.close();
    return {};
  }

  /** BullMQ's id, priority and delay for one entry; `now` is only needed for a `runAt`. */
  private options({ entry, now }: OptionsRequest): JobsOptions {
    const delay =
      entry.runAt === null || now === null
        ? 0
        : Math.max(0, new Date(entry.runAt).getTime() - now.getTime());
    return {
      jobId: JobQueueEntryId.encode({ jobId: entry.jobId, attempt: entry.attempt }),
      priority: JOB_LIMITS.priority.max + 1 - entry.priority,
      ...(delay > 0 ? { delay } : {}),
    };
  }

  /** The clock is read only for an entry with a `runAt`. */
  private now(entry: EnqueueJobQueueRequest): Date | null {
    return entry.runAt === null ? null : this.d.clock.now().now;
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
