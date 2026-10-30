import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JobNotFoundError } from './job-not-found.error.js';

const JOB_ID = randomUUID();

describe('JobNotFoundError', () => {
  it('has the JOB_NOT_FOUND code and the requested id in details', () => {
    const error = new JobNotFoundError({ id: JOB_ID });

    expect(error.code).toBe('JOB_NOT_FOUND');
    expect(error.details).toEqual({ id: JOB_ID });
  });
});
