import { describe, expect, it } from 'vitest';

import { QueryLimitExceededError } from '../domain/validation/query-limit-exceeded.error.js';
import { ConfiguredPageLimit } from './configured-page-limit.js';

describe('ConfiguredPageLimit', () => {
  const pageLimit = new ConfiguredPageLimit({ defaultLimit: 20, maxLimit: 37 });

  it('uses the configured default when no limit is asked for', () => {
    expect(pageLimit.resolve({})).toEqual({ limit: 20 });
  });

  it('keeps an asked limit up to the maximum', () => {
    expect(pageLimit.resolve({ limit: 1 })).toEqual({ limit: 1 });
    expect(pageLimit.resolve({ limit: 37 })).toEqual({ limit: 37 });
  });

  it('rejects a limit above the maximum with the page-limit error naming the maximum', () => {
    const failure = (() => {
      try {
        pageLimit.resolve({ limit: 38 });
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(QueryLimitExceededError);
    expect((failure as QueryLimitExceededError).details).toEqual(
      new QueryLimitExceededError({ maxLimit: 37 }).details,
    );
  });
});
