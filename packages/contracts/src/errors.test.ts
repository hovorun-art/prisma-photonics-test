import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@job-queue/kernel';

import { ErrorBody, ErrorCode, ValidationFailedDetails } from './index.js';

describe('ErrorCode', () => {
  it('accepts exactly the codes registered in the kernel', () => {
    expect(ErrorCode.options).toEqual([...ERROR_CODES]);
  });

  it('rejects codes that are not in the union', () => {
    expect(ErrorCode.safeParse('SOMETHING_ELSE').success).toBe(false);
  });
});

describe('ErrorBody', () => {
  it('accepts a code, a message and structured details', () => {
    const body = ErrorBody.parse({
      code: 'INTERNAL_UNAUTHORIZED',
      message: 'A valid service token is required',
      details: { route: '/internal/v1/ping' },
    });

    expect(body.code).toBe('INTERNAL_UNAUTHORIZED');
    expect(body.details).toEqual({ route: '/internal/v1/ping' });
  });

  it('accepts empty details', () => {
    expect(
      ErrorBody.safeParse({ code: 'INTERNAL_ERROR', message: 'Internal error', details: {} })
        .success,
    ).toBe(true);
  });

  it('rejects a body with an unknown code or without details', () => {
    expect(
      ErrorBody.safeParse({ code: 'NOPE', message: 'Internal error', details: {} }).success,
    ).toBe(false);
    expect(ErrorBody.safeParse({ code: 'INTERNAL_ERROR', message: 'Internal error' }).success).toBe(
      false,
    );
  });
});

describe('ValidationFailedDetails', () => {
  it('accepts the issues of a VALIDATION_FAILED body, each with a path and a message', () => {
    const details = ValidationFailedDetails.parse({
      issues: [{ path: ['payload', 'to'], message: 'Invalid email', code: 'invalid_format' }],
    });

    expect(details.issues).toEqual([{ path: ['payload', 'to'], message: 'Invalid email' }]);
  });

  it('accepts numeric path segments', () => {
    expect(
      ValidationFailedDetails.safeParse({ issues: [{ path: ['items', 0], message: 'x' }] }).success,
    ).toBe(true);
  });

  it('rejects details without issues or with an issue missing its message', () => {
    expect(ValidationFailedDetails.safeParse({}).success).toBe(false);
    expect(ValidationFailedDetails.safeParse({ issues: [{ path: [] }] }).success).toBe(false);
  });
});
