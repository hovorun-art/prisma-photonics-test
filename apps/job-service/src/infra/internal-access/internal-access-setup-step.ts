import { INTERNAL_API_PREFIX } from '@job-queue/contracts';
import type {
  ApplyServiceSetupStepRequest,
  ApplyServiceSetupStepResponse,
  ServiceSetupStep,
} from '@job-queue/service-kit';
import type { INestApplication } from '@nestjs/common';

import {
  INTERNAL_ACCESS,
  type InternalAccess,
} from '../../domain/internal-access/internal-access.js';

/** The part of an Express request this step reads. */
interface InternalRequest {
  readonly headers: { readonly authorization?: string };
}

/**
 * Checks the service token of every `/internal` call before the request body is parsed, so a call
 * without the token is answered 401 even when its body is malformed or too large. It must run
 * before `RequestBodySetupStep`. The controllers' `ServiceTokenGuard` stays as the route-level check.
 */
export class InternalAccessSetupStep implements ServiceSetupStep<INestApplication> {
  apply(req: ApplyServiceSetupStepRequest<INestApplication>): ApplyServiceSetupStepResponse {
    const access = req.app.get<InternalAccess>(INTERNAL_ACCESS, { strict: false });
    req.app.use(
      INTERNAL_API_PREFIX,
      (request: InternalRequest, _res: unknown, next: (error?: unknown) => void) => {
        try {
          access.authorize({ authorization: request.headers.authorization });
          next();
        } catch (error) {
          next(error);
        }
      },
    );
    return {};
  }
}
