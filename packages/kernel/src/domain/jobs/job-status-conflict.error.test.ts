import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JobStatusConflictError } from './job-status-conflict.error.js';

const JOB_ID = randomUUID();

describe('JobStatusConflictError', () => {
  it('has the JOB_STATUS_CONFLICT code and the current status in details', () => {
    const error = new JobStatusConflictError({ id: JOB_ID, status: 'processing' });

    expect(error.code).toBe('JOB_STATUS_CONFLICT');
    expect(error.details).toEqual({ id: JOB_ID, status: 'processing' });
  });

  it('carries only the job id when the current status is not known', () => {
    expect(new JobStatusConflictError({ id: JOB_ID }).details).toEqual({ id: JOB_ID });
  });
});
