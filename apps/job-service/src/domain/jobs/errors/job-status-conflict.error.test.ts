import { describe, expect, it } from 'vitest';

import { JobStatusConflictError } from './job-status-conflict.error.js';

describe('JobStatusConflictError', () => {
  it('has the JOB_STATUS_CONFLICT code and the current status in details', () => {
    const error = new JobStatusConflictError({
      id: '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b',
      status: 'processing',
    });

    expect(error.code).toBe('JOB_STATUS_CONFLICT');
    expect(error.details).toEqual({
      id: '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b',
      status: 'processing',
    });
  });
});
