import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JobGroupNotEmptyError } from './job-group-not-empty.error.js';

describe('JobGroupNotEmptyError', () => {
  it('has the JOB_GROUP_NOT_EMPTY code, a message and the id and child count in details', () => {
    const id = randomUUID();

    const error = new JobGroupNotEmptyError({ id, total: 3 });

    expect(error.code).toBe('JOB_GROUP_NOT_EMPTY');
    expect(error.message).toBe('Job group has jobs and cannot be deleted');
    expect(error.details).toEqual({ id, total: 3 });
  });
});
