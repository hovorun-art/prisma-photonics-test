import { describe, expect, it } from 'vitest';

import { HealthResponse } from './health.js';

describe('HealthResponse', () => {
  it('accepts { "status": "ok" }', () => {
    expect(HealthResponse.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects any other status and a missing status', () => {
    expect(HealthResponse.safeParse({ status: 'unavailable' }).success).toBe(false);
    expect(HealthResponse.safeParse({}).success).toBe(false);
  });
});
