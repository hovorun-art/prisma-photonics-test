import { createHash, timingSafeEqual } from 'node:crypto';

import { SERVICE_TOKEN_SCHEME } from '@job-queue/contracts';

import type {
  AuthorizeInternalAccessRequest,
  AuthorizeInternalAccessResponse,
  InternalAccess,
} from '../../domain/internal-access/internal-access.js';
import { UnauthorizedInternalAccessError } from '../../domain/internal-access/unauthorized-internal-access.error.js';

export interface ServiceTokenInternalAccessParams {
  /** The configured service token (`INTERNAL_SERVICE_TOKEN`). */
  serviceToken: string;
}

/** `Authorization: Bearer <token>`; the scheme in any letter case. */
const BEARER_TOKEN = new RegExp(`^${SERVICE_TOKEN_SCHEME}[ ]+(\\S+)[ ]*$`, 'i');

/**
 * Lets a call through only when its bearer token equals the configured service token. Compares
 * fixed-length digests in constant time, so neither the content nor the length of the configured
 * token leaks through response timing.
 */
export class ServiceTokenInternalAccess implements InternalAccess {
  private readonly expectedDigest: Buffer;

  constructor(p: ServiceTokenInternalAccessParams) {
    this.expectedDigest = this.digest(p.serviceToken);
  }

  authorize(req: AuthorizeInternalAccessRequest): AuthorizeInternalAccessResponse {
    const presented = BEARER_TOKEN.exec(req.authorization ?? '')?.[1];
    if (presented === undefined || !timingSafeEqual(this.digest(presented), this.expectedDigest)) {
      throw new UnauthorizedInternalAccessError();
    }
    return {};
  }

  private digest(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
  }
}
