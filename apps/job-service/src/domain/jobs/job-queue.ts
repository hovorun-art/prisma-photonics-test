import type { Closable } from '@job-queue/kernel';

/**
 * Where job-service puts job attempts for job-execution-service to pick up. Entries are handed out
 * highest priority first and, within one priority, in the order they were queued; an entry with a
 * `runAt` in the future is not handed out before that time.
 */
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
  /**
   * Where the entry of one attempt stands. Rejects with `JobQueueUnavailableError` when the queue
   * cannot be reached within the configured timeout.
   */
  state(req: StateJobQueueRequest): Promise<StateJobQueueResponse>;
  /**
   * Replaces a finished entry of the attempt with a new one under the same id, or adds it when there
   * is none. Adds nothing while a worker holds the entry. Rejects with `JobQueueUnavailableError`
   * when the queue cannot be reached within the configured timeout.
   */
  requeue(req: EnqueueJobQueueRequest): Promise<RequeueJobQueueResponse>;
}

export interface EnqueueJobQueueRequest {
  jobId: string;
  /** The job's run (1, plus one per manual retry); attempts start again at 1 in each run. */
  run: number;
  /** The attempt the entry is for, starting at 1. */
  attempt: number;
  /** The job's priority on the contract's scale (higher = more urgent). */
  priority: number;
  /** ISO instant before which the entry is not handed out; `null` or a past instant = at once. */
  runAt: string | null;
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

export interface StateJobQueueRequest {
  jobId: string;
  run: number;
  attempt: number;
}

/**
 * `waiting`: ready for a worker; `delayed`: not before its time; `active`: a worker holds it;
 * `finished`: a worker took it and let it go (completed or failed); `missing`: no such entry.
 */
export type JobQueueEntryState = 'waiting' | 'delayed' | 'active' | 'finished' | 'missing';

export interface StateJobQueueResponse {
  state: JobQueueEntryState;
}

export type RequeueJobQueueResponse = Record<string, never>;

export const JOB_QUEUE = Symbol('JobQueue');
