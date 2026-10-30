import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InvalidJobError } from './invalid-job.error.js';

const JOB_ID = randomUUID();

describe('InvalidJobError', () => {
  it('is a validation failure with the job id and the issues in details', () => {
    const issues = [{ code: 'invalid_type', path: ['payload', 'to'], message: 'Required' }];

    const error = new InvalidJobError({ id: JOB_ID, issues });

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({ id: JOB_ID, issues });
  });
});
