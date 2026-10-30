import { describe, expect, it } from 'vitest';

import { LogStoreUnavailableError } from './log-store-unavailable.error.js';

describe('LogStoreUnavailableError', () => {
  it('reports the log store as unavailable with the failed operation in its details', () => {
    const error = new LogStoreUnavailableError({ operation: 'query' });

    expect(error.code).toBe('LOG_STORE_UNAVAILABLE');
    expect(error.message).toBe('The job log store is unavailable');
    expect(error.details).toEqual({ operation: 'query' });
  });
});
