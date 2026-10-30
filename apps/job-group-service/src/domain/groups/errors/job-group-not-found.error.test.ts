import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JobGroupNotFoundError } from './job-group-not-found.error.js';

describe('JobGroupNotFoundError', () => {
  it('has the JOB_GROUP_NOT_FOUND code, a message and the id in details', () => {
    const id = randomUUID();

    const error = new JobGroupNotFoundError({ id });

    expect(error.code).toBe('JOB_GROUP_NOT_FOUND');
    expect(error.message).toBe('Job group not found');
    expect(error.details).toEqual({ id });
  });
});
