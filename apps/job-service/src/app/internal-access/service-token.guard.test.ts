import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { describe, expect, it, vi } from 'vitest';

import type { InternalAccess } from '../../domain/internal-access/internal-access.js';
import { UnauthorizedInternalAccessError } from '../../domain/internal-access/unauthorized-internal-access.error.js';
import { ServiceTokenGuard } from './service-token.guard.js';

describe('ServiceTokenGuard', () => {
  it('Valid token: lets the call through once internal access accepts its authorization header', () => {
    const access: InternalAccess = { authorize: vi.fn(() => ({})) };
    const context = new ExecutionContextHost([
      { headers: { authorization: 'Bearer a-token' } },
      {},
      () => undefined,
    ]);

    expect(new ServiceTokenGuard(access).canActivate(context)).toBe(true);
    expect(access.authorize).toHaveBeenCalledExactlyOnceWith({ authorization: 'Bearer a-token' });
  });

  it('Missing token: passes a missing header on and lets the rejection reach the error filter', () => {
    const rejection = new UnauthorizedInternalAccessError();
    const access: InternalAccess = {
      authorize: vi.fn(() => {
        throw rejection;
      }),
    };
    const context = new ExecutionContextHost([{ headers: {} }, {}, () => undefined]);

    expect(() => new ServiceTokenGuard(access).canActivate(context)).toThrow(rejection);
    expect(access.authorize).toHaveBeenCalledExactlyOnceWith({ authorization: undefined });
  });
});
