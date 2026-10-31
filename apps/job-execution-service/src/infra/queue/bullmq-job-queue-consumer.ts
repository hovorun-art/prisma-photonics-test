import { JOB_QUEUE_NAME, JobQueueEntryId, JobQueueMessage } from '@job-queue/contracts';
import type { CloseClosableResponse } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { type Job as QueueEntry, Worker } from 'bullmq';

import type {
  JobQueueConsumer,
  JobQueueEntry,
  StartJobQueueConsumerRequest,
  StartJobQueueConsumerResponse,
} from '../../domain/queue/job-queue-consumer.js';

export interface BullMqJobQueueConsumerDeps {
  logger: Pick<LoggerService, 'warn' | 'error'>;
}

export interface BullMqJobQueueConsumerParams {
  redisUrl: string;
  /** How many entries this instance runs at the same time. */
  concurrency: number;
  /**
   * How long this instance's hold on an entry lasts without renewal (renewed every half of it while
   * the process lives).
   */
  lockDurationMs: number;
  /** How often this instance looks for entries whose hold expired. */
  stalledIntervalMs: number;
}

/** Finished entries kept in Redis for inspection; older ones are removed. */
const KEEP_FINISHED_ENTRIES = 1_000;

/**
 * Takes job attempts from the BullMQ queue. An entry is taken once: `execute` settles every
 * outcome itself, so BullMQ only marks the entry completed and never retries it (job-service queues
 * a new entry per retry). An entry whose holder stopped renewing its lock (a crashed worker) is
 * never run again: with `maxStalledCount: 0` the next stalled check of any worker moves it back to
 * waiting with a deferred failure, and the worker that takes it next fails it without calling
 * `execute`. job-service's recovery pass then fails or retries the job.
 */
export class BullMqJobQueueConsumer implements JobQueueConsumer {
  private worker: Worker<JobQueueMessage> | undefined;

  constructor(
    private readonly d: BullMqJobQueueConsumerDeps,
    private readonly p: BullMqJobQueueConsumerParams,
  ) {}

  start(req: StartJobQueueConsumerRequest): StartJobQueueConsumerResponse {
    const worker = new Worker<JobQueueMessage>(
      JOB_QUEUE_NAME,
      async (entry) => {
        const parsed = this.toEntry(entry);
        if (parsed === undefined) return;
        await req.execute(parsed);
      },
      {
        connection: { url: this.p.redisUrl, connectionName: 'job-execution-service-queue' },
        concurrency: this.p.concurrency,
        lockDuration: this.p.lockDurationMs,
        stalledInterval: this.p.stalledIntervalMs,
        maxStalledCount: 0,
        autorun: false,
        removeOnComplete: { count: KEEP_FINISHED_ENTRIES },
        removeOnFail: { count: KEEP_FINISHED_ENTRIES },
      },
    );
    // Without a listener a Redis outage would surface as an unhandled 'error' event.
    worker.on('error', (err: unknown) => {
      this.d.logger.warn({ err }, 'Job queue connection error');
    });
    worker.run().catch((err: unknown) => {
      this.d.logger.error({ err }, 'Job queue consumer stopped');
    });
    this.worker = worker;
    return {};
  }

  async close(): Promise<CloseClosableResponse> {
    await this.worker?.close();
    return {};
  }

  /**
   * The job id, run and attempt from the entry id (`JobQueueEntryId`, with or without a run),
   * checked against the data.
   */
  private toEntry(entry: QueueEntry<JobQueueMessage>): JobQueueEntry | undefined {
    const message = JobQueueMessage.safeParse(entry.data);
    const id = JobQueueEntryId.safeDecode(entry.id ?? '');
    if (!message.success || !id.success || id.data.jobId !== message.data.jobId) {
      this.d.logger.error({ entryId: entry.id }, 'Dropped a malformed queue entry');
      return undefined;
    }
    return { jobId: id.data.jobId, run: id.data.run, attempt: id.data.attempt };
  }
}
