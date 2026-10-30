import { DomainError } from '@job-queue/kernel';

export interface LogStoreUnavailableErrorParams {
  /** What the caller tried: storing a batch, reading a log, or applying the schema. */
  operation: 'insert' | 'query' | 'schema';
}

/** The job log store could not be reached (connection refused, timeout or server error). */
export class LogStoreUnavailableError extends DomainError<'LOG_STORE_UNAVAILABLE'> {
  constructor(p: LogStoreUnavailableErrorParams) {
    super({
      code: 'LOG_STORE_UNAVAILABLE',
      message: 'The job log store is unavailable',
      details: { operation: p.operation },
    });
  }
}
