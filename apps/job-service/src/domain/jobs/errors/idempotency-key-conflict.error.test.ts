import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { IdempotencyKeyConflictError } from './idempotency-key-conflict.error.js';

describe('IdempotencyKeyConflictError', () => {
  it('has the IDEMPOTENCY_KEY_CONFLICT code and names the key and the existing job', () => {
    const existingJobId = randomUUID();

    const error = new IdempotencyKeyConflictError({ idempotencyKey: 'receipt-1', existingJobId });

    expect(error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(error.details).toEqual({ idempotencyKey: 'receipt-1', existingJobId });
  });
});
