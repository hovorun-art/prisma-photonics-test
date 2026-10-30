import { DomainError } from '@job-queue/kernel';

export interface JobServiceUnavailableErrorParams {
  /** What went wrong: a network error, a timeout or an HTTP status. */
  reason: string;
}

/** job-service could not be reached or answered with a server error; the call may be retried. */
export class JobServiceUnavailableError extends DomainError<'JOB_SERVICE_UNAVAILABLE'> {
  constructor(p: JobServiceUnavailableErrorParams) {
    super({
      code: 'JOB_SERVICE_UNAVAILABLE',
      message: 'job-service is unavailable',
      details: { reason: p.reason },
    });
  }
}
