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
import { type JobState, type JobsOptions, Queue } from 'bullmq';
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
  JobQueueEntryState,
  RequeueJobQueueResponse,
  StateJobQueueRequest,
  StateJobQueueResponse,
} from '../../../domain/jobs/job-queue.js';

/** Our view of BullMQ's entry states: what matters is whether a worker can still run the entry. */
const ENTRY_STATES: Readonly<Record<JobState | 'unknown', JobQueueEntryState>> = {
  waiting: 'waiting',
  prioritized: 'waiting',
  'waiting-children': 'waiting',
  delayed: 'delayed',
  active: 'active',
  completed: 'finished',
  failed: 'finished',
  unknown: 'missing',
};

export interface BullMqJobQueueDeps {
  logger: Pick<LoggerService, 'warn'>;
  /** The time an entry's delay is counted from. */
  clock: Clock;
}

interface WithinSignalRequest<T> {
  work: Promise<T>;
  signal: AbortSignal;
}

interface OptionsRequest {
  entry: EnqueueJobQueueRequest;
  now: Date | null;
}

export interface BullMqJobQueueParams {
  redisUrl: string;
  /** How long `enqueue`, `enqueueMany`, `cancel`, `state` and `requeue` wait for Redis before they give up. */
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

  async state(req: StateJobQueueRequest): Promise<StateJobQueueResponse> {
    const attempt = { jobId: req.jobId, run: req.run, attempt: req.attempt };
    try {
      const found = await this.withinTimeout(this.queue.getJobState(this.entryId(req)));
      return { state: ENTRY_STATES[found] };
    } catch {
      // The recovery pass, the only caller, logs one line for the whole pass.
      throw new JobQueueUnavailableError(attempt);
    }
  }

  /**
   * A finished entry is removed first, since BullMQ ignores an `add` under an id it still has. A
   * live entry (waiting, delayed, or held by a worker) is left alone; BullMQ also refuses to remove
   * an entry a worker took meanwhile, and then nothing is added.
   */
  async requeue(req: EnqueueJobQueueRequest): Promise<RequeueJobQueueResponse> {
    const attempt = { jobId: req.jobId, run: req.run, attempt: req.attempt };
    const id = this.entryId(req);
    try {
      await this.withinTimeout(
        (async () => {
          const state = ENTRY_STATES[await this.queue.getJobState(id)];
          if (state === 'finished' && (await this.queue.remove(id)) === 0) return;
          if (state === 'finished' || state === 'missing') {
            await this.queue.add(
              id,
              { jobId: req.jobId },
              this.options({ entry: req, now: this.now(req) }),
            );
          }
        })(),
      );
    } catch (err) {
      this.d.logger.warn({ err, ...attempt }, 'Requeue failed');
      throw new JobQueueUnavailableError(attempt);
    }
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

  private entryId(entry: StateJobQueueRequest): string {
    return JobQueueEntryId.encode({ jobId: entry.jobId, run: entry.run, attempt: entry.attempt });
  }

  /** The clock is read only for an entry with a `runAt`. */
  private now(entry: EnqueueJobQueueRequest): Date | null {
    return entry.runAt === null ? null : this.d.clock.now().now;
  }

  /** `work`'s value, or a rejection when it has not settled within the configured enqueue timeout. */
  private withinTimeout<T>(work: Promise<T>): Promise<T> {
    return this.withinSignal({ work, signal: AbortSignal.timeout(this.p.enqueueTimeoutMs) });
  }

  /** `work`'s value, or a rejection when `signal` aborts before it has settled. */
  private async withinSignal<T>({ work, signal }: WithinSignalRequest<T>): Promise<T> {
    signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(signal.reason as Error);
      });
    });
    return Promise.race([work, aborted]);
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
