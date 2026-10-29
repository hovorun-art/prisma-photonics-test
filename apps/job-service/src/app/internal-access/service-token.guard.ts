import type { IncomingHttpHeaders } from 'node:http';

import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';

import {
  INTERNAL_ACCESS,
  type InternalAccess,
} from '../../domain/internal-access/internal-access.js';

/**
 * Put it on every controller under `/internal` (with `@UseGuards`), so a route-level guard, not a
 * path check, protects them. A call without the configured service token fails with
 * `UnauthorizedInternalAccessError`, which the app's error filter maps to 401.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(@Inject(INTERNAL_ACCESS) private readonly access: InternalAccess) {}

  canActivate(context: ExecutionContext): boolean {
    const { headers } = context.switchToHttp().getRequest<{ headers: IncomingHttpHeaders }>();
    this.access.authorize({ authorization: headers.authorization });
    return true;
  }
}
