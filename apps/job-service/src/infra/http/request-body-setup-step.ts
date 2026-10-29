import type {
  ApplyServiceSetupStepRequest,
  ApplyServiceSetupStepResponse,
  ServiceSetupStep,
} from '@job-queue/service-kit';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import {
  JOB_SERVICE_CONFIG,
  type JobServiceConfig,
} from '../../domain/config/job-service-config.js';
import { MalformedBodyError } from '../../domain/http/malformed-body.error.js';
import { PayloadTooLargeError } from '../../domain/http/payload-too-large.error.js';

/** The part of a body parser error this step reads (`body-parser` sets `type`, and `limit` on size). */
interface BodyParserError {
  readonly type: unknown;
  readonly limit?: unknown;
}

/**
 * Sets the request body limit explicitly from the configured `bodyLimitBytes`, and turns the body
 * parser's errors into domain errors: invalid JSON becomes `MalformedBodyError` and a body over
 * the limit becomes `PayloadTooLargeError`. Nest would otherwise replace the first by a generic
 * 400 and let the second through as an unknown error. Any other error is passed on untouched.
 */
export class RequestBodySetupStep implements ServiceSetupStep<INestApplication> {
  apply(req: ApplyServiceSetupStepRequest<INestApplication>): ApplyServiceSetupStepResponse {
    const config = req.app.get<JobServiceConfig>(JOB_SERVICE_CONFIG, { strict: false });
    // job-service always runs on Express, whose adapter offers `useBodyParser`.
    const app = req.app as NestExpressApplication;
    app.useBodyParser('json', { limit: config.bodyLimitBytes });
    app.useBodyParser('urlencoded', { limit: config.bodyLimitBytes, extended: true });
    // Registered right after the parsers, so it sees their errors before Nest's own handler.
    app.use((error: unknown, _req: unknown, _res: unknown, next: (error?: unknown) => void) => {
      next(this.mapBodyParserError(error));
    });
    return {};
  }

  private mapBodyParserError(error: unknown): unknown {
    if (typeof error !== 'object' || error === null || !('type' in error)) {
      return error;
    }
    const { type, limit } = error as BodyParserError;
    if (type === 'entity.parse.failed') {
      return new MalformedBodyError();
    }
    if (type === 'entity.too.large' && typeof limit === 'number') {
      return new PayloadTooLargeError({ limitBytes: limit });
    }
    return error;
  }
}
