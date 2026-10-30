import { INTERNAL_API_PREFIX } from '@job-queue/contracts';
import type { INestApplication } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import {
  INTERNAL_ACCESS,
  type InternalAccess,
} from '../../domain/internal-access/internal-access.js';
import { UnauthorizedInternalAccessError } from '../../domain/internal-access/unauthorized-internal-access.error.js';
import { InternalAccessSetupStep } from './internal-access-setup-step.js';

type Middleware = (
  req: { headers: { authorization?: string } },
  res: unknown,
  next: (error?: unknown) => void,
) => void;

describe('InternalAccessSetupStep', () => {
  const setup = () => {
    const access = mockDeep<InternalAccess>();
    const app = mockDeep<INestApplication>();
    app.get.mockReturnValueOnce(access);
    new InternalAccessSetupStep().apply({ app });
    expect(app.get).toHaveBeenCalledExactlyOnceWith(INTERNAL_ACCESS, { strict: false });
    const [path, middleware] = app.use.mock.calls[0] as unknown as [string, Middleware];
    const run = (authorization?: string): unknown => {
      const next = vi.fn();
      middleware({ headers: authorization === undefined ? {} : { authorization } }, {}, next);
      expect(next).toHaveBeenCalledOnce();
      return next.mock.calls[0]?.[0];
    };
    return { access, path, run };
  };

  it('Valid token: checks the token for every /internal route and lets the call through', () => {
    const { access, path, run } = setup();
    access.authorize.mockReturnValueOnce({});

    expect(path).toBe(INTERNAL_API_PREFIX);
    expect(run('Bearer a-token')).toBeUndefined();
    expect(access.authorize).toHaveBeenCalledExactlyOnceWith({ authorization: 'Bearer a-token' });
  });

  it('Missing token: hands the rejection on, so the body is never read and the filter answers 401', () => {
    const { access, run } = setup();
    const rejection = new UnauthorizedInternalAccessError();
    access.authorize.mockImplementationOnce(() => {
      throw rejection;
    });

    expect(run()).toBe(rejection);
    expect(access.authorize).toHaveBeenCalledExactlyOnceWith({ authorization: undefined });
  });
});
