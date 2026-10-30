import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JobQueueUnavailableError } from './job-queue-unavailable.error.js';

const JOB_ID = randomUUID();

describe('JobQueueUnavailableError', () => {
  it('has the QUEUE_UNAVAILABLE code and names the entry that was not queued', () => {
    const error = new JobQueueUnavailableError({
      jobId: JOB_ID,
      run: 3,
      attempt: 2,
    });

    expect(error.code).toBe('QUEUE_UNAVAILABLE');
    expect(error.details).toEqual({ jobId: JOB_ID, run: 3, attempt: 2 });
  });

  it('names every entry of a bulk that was not queued', () => {
    const entries = [
      { jobId: JOB_ID, run: 1, attempt: 1 },
      { jobId: randomUUID(), run: 2, attempt: 1 },
    ];

    const error = new JobQueueUnavailableError({ entries });

    expect(error.code).toBe('QUEUE_UNAVAILABLE');
    expect(error.details).toEqual({ entries });
  });

  it('names the job whose cancellation could not be announced', () => {
    const error = new JobQueueUnavailableError({ cancelledJobId: JOB_ID });

    expect(error.code).toBe('QUEUE_UNAVAILABLE');
    expect(error.details).toEqual({ jobId: JOB_ID });
  });
});
