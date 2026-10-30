import { DomainError } from '@job-queue/kernel';

/** One attempt that could not be put on the queue. */
export interface UnqueuedJobAttempt {
  jobId: string;
  run: number;
  attempt: number;
}

/**
 * One attempt (`enqueue`), every attempt of a bulk (`enqueueMany`), or a job whose cancellation
 * could not be announced (`cancel`).
 */
export type JobQueueUnavailableErrorParams =
  UnqueuedJobAttempt | { entries: UnqueuedJobAttempt[] } | { cancelledJobId: string };

/** The queue could not be reached or was too slow (Redis unreachable or stalled). */
export class JobQueueUnavailableError extends DomainError<'QUEUE_UNAVAILABLE'> {
  constructor(p: JobQueueUnavailableErrorParams) {
    super({
      code: 'QUEUE_UNAVAILABLE',
      message: 'The job queue is unavailable',
      details: JobQueueUnavailableError.toDetails(p),
    });
  }

  private static toDetails(p: JobQueueUnavailableErrorParams): Record<string, unknown> {
    if ('entries' in p) return { entries: p.entries };
    if ('cancelledJobId' in p) return { jobId: p.cancelledJobId };
    return { jobId: p.jobId, run: p.run, attempt: p.attempt };
  }
}
