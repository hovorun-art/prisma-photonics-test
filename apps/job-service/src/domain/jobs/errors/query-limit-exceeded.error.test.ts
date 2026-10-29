import { describe, expect, it } from 'vitest';

import { QueryLimitExceededError } from './query-limit-exceeded.error.js';

describe('QueryLimitExceededError', () => {
  it('is a validation failure with one issue on the limit field, like a schema issue', () => {
    const error = new QueryLimitExceededError({ maxLimit: 100 });

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({
      issues: [
        {
          code: 'too_big',
          path: ['limit'],
          maximum: 100,
          message: 'limit must be at most 100',
        },
      ],
    });
  });
});
