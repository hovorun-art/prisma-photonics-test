import { describe, expect, it } from 'vitest';

import { VALIDATION_FAILED_MESSAGE } from '@job-queue/kernel';
import { InvalidJobPayloadError } from './invalid-job-payload.error.js';

describe('InvalidJobPayloadError', () => {
  it('is a validation failure whose issues sit under the payload field', () => {
    const error = new InvalidJobPayloadError({
      issues: [{ code: 'custom', path: ['departureDate'], message: 'The departure day is over' }],
    });

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe(VALIDATION_FAILED_MESSAGE);
    expect(error.details).toEqual({
      issues: [
        {
          code: 'custom',
          path: ['payload', 'departureDate'],
          message: 'The departure day is over',
        },
      ],
    });
  });
});
