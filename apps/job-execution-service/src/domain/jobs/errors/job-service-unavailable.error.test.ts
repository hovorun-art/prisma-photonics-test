import { describe, expect, it } from 'vitest';

import { JobServiceUnavailableError } from './job-service-unavailable.error.js';

describe('JobServiceUnavailableError', () => {
  it('has the JOB_SERVICE_UNAVAILABLE code and the reason in details', () => {
    const error = new JobServiceUnavailableError({ reason: 'HTTP 503' });

    expect(error.code).toBe('JOB_SERVICE_UNAVAILABLE');
    expect(error.details).toEqual({ reason: 'HTTP 503' });
  });
});
