import { DomainError } from '@job-queue/kernel';

import { VALIDATION_FAILED_MESSAGE } from '../../http/validation-failed.js';

export interface BulkLimitExceededErrorParams {
  /** The configured maximum number of jobs per bulk submission. */
  maxJobs: number;
}

/**
 * A bulk submission holds more jobs than the configured maximum. It is a validation failure whose
 * issue has the same shape as a schema issue, so clients handle both alike.
 */
export class BulkLimitExceededError extends DomainError<'VALIDATION_FAILED'> {
  constructor(p: BulkLimitExceededErrorParams) {
    super({
      code: 'VALIDATION_FAILED',
      message: VALIDATION_FAILED_MESSAGE,
      details: {
        issues: [
          {
            code: 'too_big',
            path: ['jobs'],
            maximum: p.maxJobs,
            message: `jobs must hold at most ${p.maxJobs} jobs`,
          },
        ],
      },
    });
  }
}
