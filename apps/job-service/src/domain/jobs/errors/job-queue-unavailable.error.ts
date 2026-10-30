import { DomainError } from '@job-queue/kernel';

/** One attempt that could not be put on the queue. */
export interface UnqueuedJobAttempt {
  jobId: string;
  attempt: number;
}

/** One attempt (`enqueue`) or every attempt of a bulk (`enqueueMany`). */
export type JobQueueUnavailableErrorParams = UnqueuedJobAttempt | { entries: UnqueuedJobAttempt[] };

/** Job attempts could not be put on the queue (Redis unreachable or too slow). */
export class JobQueueUnavailableError extends DomainError<'QUEUE_UNAVAILABLE'> {
  constructor(p: JobQueueUnavailableErrorParams) {
    super({
      code: 'QUEUE_UNAVAILABLE',
      message: 'The job queue is unavailable',
      details: 'entries' in p ? { entries: p.entries } : { jobId: p.jobId, attempt: p.attempt },
    });
  }
}
