import { describe, expect, it } from 'vitest';

import { JobLogStreamUnavailableError } from './job-log-stream-unavailable.error.js';

describe('JobLogStreamUnavailableError', () => {
  it('reports the job log stream as unavailable with the wait that ran out in its details', () => {
    const error = new JobLogStreamUnavailableError({ openTimeoutMs: 50 });

    expect(error.code).toBe('JOB_LOG_STREAM_UNAVAILABLE');
    expect(error.message).toBe('The job log stream connection was not ready within 50 ms');
    expect(error.details).toEqual({ openTimeoutMs: 50 });
  });
});
