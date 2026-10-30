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
}

/** Finished entries kept in Redis for inspection; older ones are removed. */
const KEEP_FINISHED_ENTRIES = 1_000;

/**
 * Takes job attempts from the BullMQ queue. An entry is taken once: `execute` settles every
 * outcome itself, so BullMQ only marks the entry completed and never retries it (job-service queues
 * a new entry per retry). A stalled entry of a crashed worker may be redelivered; `execute` then
 * finds the job no longer pending and drops it.
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
   * The job id and attempt from the entry id (`JobQueueEntryId`, with or without a run), checked
   * against the data.
   */
  private toEntry(entry: QueueEntry<JobQueueMessage>): JobQueueEntry | undefined {
    const message = JobQueueMessage.safeParse(entry.data);
    const id = JobQueueEntryId.safeDecode(entry.id ?? '');
    if (!message.success || !id.success || id.data.jobId !== message.data.jobId) {
      this.d.logger.error({ entryId: entry.id }, 'Dropped a malformed queue entry');
      return undefined;
    }
    // The run only keeps entry ids unique in job-service; running an entry needs the attempt.
    return { jobId: id.data.jobId, attempt: id.data.attempt };
  }
}
