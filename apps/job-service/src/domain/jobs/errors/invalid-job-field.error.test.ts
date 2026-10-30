import { describe, expect, it } from 'vitest';

import { VALIDATION_FAILED_MESSAGE } from '@job-queue/kernel';
import { InvalidJobFieldError } from './invalid-job-field.error.js';

describe('InvalidJobFieldError', () => {
  it('is a validation failure whose issue paths start with the field', () => {
    const error = new InvalidJobFieldError({
      field: ['payload'],
      issues: [{ code: 'custom', path: ['waypoints', 0, 'lat'], message: 'Too big' }],
    });

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe(VALIDATION_FAILED_MESSAGE);
    expect(error.details).toEqual({
      issues: [{ code: 'custom', path: ['payload', 'waypoints', 0, 'lat'], message: 'Too big' }],
    });
  });

  it('puts a nested field path, such as an item of a bulk, in front of each issue path', () => {
    const error = new InvalidJobFieldError({
      field: ['jobs'],
      issues: [
        { code: 'custom', path: [1, 'payload', 'departureDate'], message: 'Over' },
        { code: 'custom', path: [3, 'payload', 'departureDate'], message: 'Over' },
      ],
    });

    expect(error.details).toEqual({
      issues: [
        { code: 'custom', path: ['jobs', 1, 'payload', 'departureDate'], message: 'Over' },
        { code: 'custom', path: ['jobs', 3, 'payload', 'departureDate'], message: 'Over' },
      ],
    });
  });
});
