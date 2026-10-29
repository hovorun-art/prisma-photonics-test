import { describe, expect, it } from 'vitest';

import { InvalidJobResultError } from './invalid-job-result.error.js';

describe('InvalidJobResultError', () => {
  it('is a validation failure whose issues sit under the result field', () => {
    const error = new InvalidJobResultError({
      issues: [{ code: 'invalid_type', path: ['messageId'], message: 'Required' }],
    });

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({
      issues: [{ code: 'invalid_type', path: ['result', 'messageId'], message: 'Required' }],
    });
  });
});
