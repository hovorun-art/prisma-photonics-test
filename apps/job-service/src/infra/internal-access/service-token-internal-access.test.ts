import { SERVICE_TOKEN_SCHEME } from '@job-queue/contracts';
import { describe, expect, it } from 'vitest';

import { UnauthorizedInternalAccessError } from '../../domain/internal-access/unauthorized-internal-access.error.js';
import { ServiceTokenInternalAccess } from './service-token-internal-access.js';

const CONFIGURED_TOKEN = 'configured-service-token';

describe('ServiceTokenInternalAccess', () => {
  const access = new ServiceTokenInternalAccess({ serviceToken: CONFIGURED_TOKEN });

  it('Missing token: rejects a call without an authorization header with INTERNAL_UNAUTHORIZED', () => {
    const authorize = (): unknown => access.authorize({ authorization: undefined });

    expect(authorize).toThrow(UnauthorizedInternalAccessError);
    expect(authorize).toThrow(expect.objectContaining({ code: 'INTERNAL_UNAUTHORIZED' }));
  });

  it('Missing token: rejects a header that carries no bearer token', () => {
    expect(() => access.authorize({ authorization: `${SERVICE_TOKEN_SCHEME} ` })).toThrow(
      UnauthorizedInternalAccessError,
    );
    for (const authorization of [`Basic ${CONFIGURED_TOKEN}`, CONFIGURED_TOKEN, '']) {
      expect(() => access.authorize({ authorization })).toThrow(UnauthorizedInternalAccessError);
    }
  });

  it('Wrong token: rejects a token of the same length that differs from the configured one', () => {
    const sameLength = CONFIGURED_TOKEN.replace(/.$/, 'X');
    const authorize = (): unknown =>
      access.authorize({ authorization: `${SERVICE_TOKEN_SCHEME} ${sameLength}` });

    expect(authorize).toThrow(UnauthorizedInternalAccessError);
    expect(authorize).toThrow(expect.objectContaining({ code: 'INTERNAL_UNAUTHORIZED' }));
  });

  it('Wrong token: rejects tokens of a different length without leaking a comparison error', () => {
    for (const token of ['short', `${CONFIGURED_TOKEN}-longer`]) {
      expect(() => access.authorize({ authorization: `${SERVICE_TOKEN_SCHEME} ${token}` })).toThrow(
        UnauthorizedInternalAccessError,
      );
    }
  });

  it('Valid token: lets a call with the configured bearer token through', () => {
    expect(
      access.authorize({ authorization: `${SERVICE_TOKEN_SCHEME} ${CONFIGURED_TOKEN}` }),
    ).toEqual({});
  });

  it('Valid token: accepts the bearer scheme in any letter case', () => {
    expect(access.authorize({ authorization: `bearer ${CONFIGURED_TOKEN}` })).toEqual({});
  });
});
