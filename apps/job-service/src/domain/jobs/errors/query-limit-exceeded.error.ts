import { DomainError } from '@job-queue/kernel';

export interface QueryLimitExceededErrorParams {
  /** The configured maximum page size. */
  maxLimit: number;
}

/**
 * A job query asked for more items than the configured maximum page size. It is a validation
 * failure whose issue has the same shape as a schema issue, so clients handle both alike.
 */
export class QueryLimitExceededError extends DomainError<'VALIDATION_FAILED'> {
  constructor(p: QueryLimitExceededErrorParams) {
    super({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: {
        issues: [
          {
            code: 'too_big',
            path: ['limit'],
            maximum: p.maxLimit,
            message: `limit must be at most ${p.maxLimit}`,
          },
        ],
      },
    });
  }
}
