import { describe, expect, it } from 'vitest';

import { QueryLimitExceededError } from './query-limit-exceeded.error.js';
import { VALIDATION_FAILED_MESSAGE } from './validation-failed.js';

describe('QueryLimitExceededError', () => {
  it('is a validation failure with one issue on the limit field, like a schema issue', () => {
    const error = new QueryLimitExceededError({ maxLimit: 37 });

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe(VALIDATION_FAILED_MESSAGE);
    expect(error.details).toEqual({
      issues: [
        {
          code: 'too_big',
          path: ['limit'],
          maximum: 37,
          message: 'limit must be at most 37',
        },
      ],
    });
  });
});
