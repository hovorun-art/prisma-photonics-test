import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JobQueueUnavailableError } from './job-queue-unavailable.error.js';

const JOB_ID = randomUUID();

describe('JobQueueUnavailableError', () => {
  it('has the QUEUE_UNAVAILABLE code and names the entry that was not queued', () => {
    const error = new JobQueueUnavailableError({
      jobId: JOB_ID,
      attempt: 2,
    });

    expect(error.code).toBe('QUEUE_UNAVAILABLE');
    expect(error.details).toEqual({ jobId: JOB_ID, attempt: 2 });
  });

  it('names every entry of a bulk that was not queued', () => {
    const entries = [
      { jobId: JOB_ID, attempt: 1 },
      { jobId: randomUUID(), attempt: 1 },
    ];

    const error = new JobQueueUnavailableError({ entries });

    expect(error.code).toBe('QUEUE_UNAVAILABLE');
    expect(error.details).toEqual({ entries });
  });
});
