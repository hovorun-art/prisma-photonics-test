import { DomainError } from '@job-queue/kernel';

export interface JobLogStreamUnavailableErrorParams {
  /** How long the connection was given to become ready. */
  openTimeoutMs: number;
}

/**
 * The job log stream's Redis connection was not ready in time. Expected at startup while Redis is
 * down; the service carries on and job log entries are dropped until it is back.
 */
export class JobLogStreamUnavailableError extends DomainError<'JOB_LOG_STREAM_UNAVAILABLE'> {
  constructor(p: JobLogStreamUnavailableErrorParams) {
    super({
      code: 'JOB_LOG_STREAM_UNAVAILABLE',
      message: `The job log stream connection was not ready within ${String(p.openTimeoutMs)} ms`,
      details: { openTimeoutMs: p.openTimeoutMs },
    });
  }
}
