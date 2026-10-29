import { describe, expect, it } from 'vitest';

import { JobNotFoundError } from './job-not-found.error.js';

describe('JobNotFoundError', () => {
  it('has the JOB_NOT_FOUND code and the requested id in details', () => {
    const error = new JobNotFoundError({ id: '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b' });

    expect(error.code).toBe('JOB_NOT_FOUND');
    expect(error.details).toEqual({ id: '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b' });
  });
});
