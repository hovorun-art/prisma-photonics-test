import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/api-error';
import { ApiRejectionAlert } from './api-rejection-alert';

const alert = new ApiRejectionAlert();
const VALIDATION = new ApiError({
  status: 400,
  code: 'VALIDATION_FAILED',
  message: 'Validation failed',
});

describe('ApiRejectionAlert', () => {
  it('an error other than VALIDATION_FAILED shows its message', () => {
    const error = new ApiError({ status: 503, code: 'QUEUE_UNAVAILABLE', message: 'Queue down' });

    expect(alert.message({ error, fieldCount: 0, unmatched: [] })).toEqual({
      message: 'Queue down',
    });
  });

  it('an error without a code (API unreachable) shows its message', () => {
    const error = new ApiError({ status: null, code: null, message: 'API unreachable' });

    expect(alert.message({ error, fieldCount: 0, unmatched: [] }).message).toBe('API unreachable');
  });

  it('a validation rejection whose issues are all on fields shows no alert', () => {
    expect(alert.message({ error: VALIDATION, fieldCount: 2, unmatched: [] }).message).toBeNull();
  });

  it('issues that fit no field are shown, joined', () => {
    expect(
      alert.message({ error: VALIDATION, fieldCount: 1, unmatched: ['Too many jobs', 'Bad'] })
        .message,
    ).toBe('Too many jobs Bad');
  });

  it('a validation rejection with no issues shows the error message', () => {
    expect(alert.message({ error: VALIDATION, fieldCount: 0, unmatched: [] }).message).toBe(
      'Validation failed',
    );
  });
});
