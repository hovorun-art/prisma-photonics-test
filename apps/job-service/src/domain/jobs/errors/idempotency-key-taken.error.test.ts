import { describe, expect, it } from 'vitest';

import { IdempotencyKeyTakenError } from './idempotency-key-taken.error.js';

describe('IdempotencyKeyTakenError', () => {
  it('has the INTERNAL_ERROR code, a generic message and no details', () => {
    const error = new IdempotencyKeyTakenError();

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('Internal server error');
    expect(error.details).toEqual({});
  });
});
