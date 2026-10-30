import type { Closable } from '@job-queue/kernel';

/** Where job-service puts job attempts for job-execution-service to pick up. */
export interface JobQueue extends Closable {
  /**
   * Puts one entry for the job's attempt on the queue; the same attempt is never queued twice.
   * Rejects when the queue cannot be reached within the configured timeout.
   */
  enqueue(req: EnqueueJobQueueRequest): Promise<EnqueueJobQueueResponse>;
  /**
   * Puts the entries of many attempts on the queue in one call, all or none; entries already on the
   * queue are not added twice. Rejects when the queue cannot be reached within the configured
   * timeout.
   */
  enqueueMany(req: EnqueueManyJobQueueRequest): Promise<EnqueueManyJobQueueResponse>;
  /**
   * Tells the workers that the job was cancelled, so the one running it stops. Fire and forget: a
   * worker that is not listening misses it. Rejects with `JobQueueUnavailableError` when the queue
   * cannot be reached within the configured timeout.
   */
  cancel(req: CancelJobQueueRequest): Promise<CancelJobQueueResponse>;
}

export interface EnqueueJobQueueRequest {
  jobId: string;
  /** The job's run (1, plus one per manual retry); attempts start again at 1 in each run. */
  run: number;
  /** The attempt the entry is for, starting at 1. */
  attempt: number;
}

export type EnqueueJobQueueResponse = Record<string, never>;

export interface EnqueueManyJobQueueRequest {
  entries: EnqueueJobQueueRequest[];
}

export type EnqueueManyJobQueueResponse = Record<string, never>;

export interface CancelJobQueueRequest {
  jobId: string;
}

export type CancelJobQueueResponse = Record<string, never>;

export const JOB_QUEUE = Symbol('JobQueue');
