import { DomainError } from '@job-queue/kernel';

export interface JobQueueUnavailableErrorParams {
  jobId: string;
  attempt: number;
}

/** A job attempt could not be put on the queue (Redis unreachable or too slow). */
export class JobQueueUnavailableError extends DomainError<'QUEUE_UNAVAILABLE'> {
  constructor(p: JobQueueUnavailableErrorParams) {
    super({
      code: 'QUEUE_UNAVAILABLE',
      message: 'The job queue is unavailable',
      details: { jobId: p.jobId, attempt: p.attempt },
    });
  }
}
