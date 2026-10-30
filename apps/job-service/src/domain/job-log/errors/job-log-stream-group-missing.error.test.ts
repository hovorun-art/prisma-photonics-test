import { describe, expect, it } from 'vitest';

import { JobLogStreamGroupMissingError } from './job-log-stream-group-missing.error.js';

describe('JobLogStreamGroupMissingError', () => {
  it('reports the missing consumer group with a stable code', () => {
    const error = new JobLogStreamGroupMissingError();

    expect(error.code).toBe('JOB_LOG_STREAM_GROUP_MISSING');
    expect(error.message).toBe('The job log stream has no consumer group');
    expect(error.details).toEqual({});
  });
});
