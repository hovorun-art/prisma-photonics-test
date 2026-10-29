import { describe, expect, it } from 'vitest';

import { JobQueueUnavailableError } from './job-queue-unavailable.error.js';

describe('JobQueueUnavailableError', () => {
  it('has the QUEUE_UNAVAILABLE code and names the entry that was not queued', () => {
    const error = new JobQueueUnavailableError({
      jobId: '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b',
      attempt: 2,
    });

    expect(error.code).toBe('QUEUE_UNAVAILABLE');
    expect(error.details).toEqual({ jobId: '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b', attempt: 2 });
  });
});
