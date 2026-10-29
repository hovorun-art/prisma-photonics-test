import type { Closable } from '@job-queue/kernel';

/** Where job-service puts job attempts for job-execution-service to pick up. */
export interface JobQueue extends Closable {
  /**
   * Puts one entry for the job's attempt on the queue; the same attempt is never queued twice.
   * Rejects when the queue cannot be reached within the configured timeout.
   */
  enqueue(req: EnqueueJobQueueRequest): Promise<EnqueueJobQueueResponse>;
}

export interface EnqueueJobQueueRequest {
  jobId: string;
  /** The attempt the entry is for, starting at 1. */
  attempt: number;
}

export type EnqueueJobQueueResponse = Record<string, never>;

export const JOB_QUEUE = Symbol('JobQueue');
