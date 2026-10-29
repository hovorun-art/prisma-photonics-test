import { DomainError } from '@job-queue/kernel';

import { VALIDATION_FAILED_MESSAGE } from '../../http/validation-failed.js';

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
      message: VALIDATION_FAILED_MESSAGE,
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
