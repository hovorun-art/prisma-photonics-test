import type { Closable } from '@job-queue/kernel';

/** Takes job attempts from the queue and hands each to `execute`, several at once. */
export interface JobQueueConsumer extends Closable {
  /** Starts taking entries. `close()` stops taking new ones and waits for running ones. */
  start(req: StartJobQueueConsumerRequest): StartJobQueueConsumerResponse;
}

/** One queue entry: the job, the run and the attempt it was queued for. */
export interface JobQueueEntry {
  jobId: string;
  /** The job's run (1, plus one per manual retry); every report of the entry carries it. */
  run: number;
  attempt: number;
}

export interface StartJobQueueConsumerRequest {
  /** Runs one entry; it must settle every outcome itself and never reject. */
  execute: (entry: JobQueueEntry) => Promise<unknown>;
}

export type StartJobQueueConsumerResponse = Record<string, never>;

export const JOB_QUEUE_CONSUMER = Symbol('JobQueueConsumer');
