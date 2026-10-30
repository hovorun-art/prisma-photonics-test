import { describe, expect, it } from 'vitest';

import { BulkLimitExceededError } from './bulk-limit-exceeded.error.js';

describe('BulkLimitExceededError', () => {
  it('is a validation failure with one issue on the jobs field naming the maximum, like a schema issue', () => {
    const error = new BulkLimitExceededError({ maxJobs: 100 });

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({
      issues: [
        {
          code: 'too_big',
          path: ['jobs'],
          maximum: 100,
          message: 'jobs must hold at most 100 jobs',
        },
      ],
    });
  });
});
