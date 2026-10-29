import type { ErrorBody } from '@job-queue/contracts';
import { DomainError, type ErrorCode } from '@job-queue/kernel';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';

/** HTTP status per error code. A new code in `ERROR_CODES` does not compile until it has a row here. */
export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, HttpStatus>> = {
  INTERNAL_UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  ROUTE_NOT_FOUND: HttpStatus.NOT_FOUND,
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

/**
 * The one exception filter of job-service. A `DomainError` becomes the status of its code and the
 * body `{code, message, details}`; anything unexpected is logged with its stack and answered with
 * a generic 500 `INTERNAL_ERROR`. Framework errors are mapped to codes: an unknown route is
 * `ROUTE_NOT_FOUND`, a Zod validation failure is `VALIDATION_FAILED` with the issues (and their
 * field paths) in `details`. Any other framework error (body parser errors are mapped to domain errors by
 * `RequestBodySetupStep`) is unexpected.
 */
@Catch()
export class ErrorResponseFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorResponseFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    if (this.isDomainError(exception)) {
      const body: ErrorBody = {
        code: exception.code,
        message: exception.message,
        details: { ...exception.details },
      };
      response.status(HTTP_STATUS_BY_ERROR_CODE[exception.code]).json(body);
      return;
    }

    if (exception instanceof NotFoundException) {
      this.send(response, 'ROUTE_NOT_FOUND', 'Route not found', {});
      return;
    }

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      const issues = zodError instanceof ZodError ? zodError.issues : [];
      this.send(response, 'VALIDATION_FAILED', 'Request validation failed', { issues });
      return;
    }

    // Anything else, including other framework errors, is unexpected and never passes through.
    this.logger.error({ err: exception }, 'Unhandled error');
    this.send(response, 'INTERNAL_ERROR', 'Internal server error', {});
  }

  private send(
    response: JsonResponse,
    code: ErrorCode,
    message: string,
    details: Record<string, unknown>,
  ): void {
    const body: ErrorBody = { code, message, details };
    response.status(HTTP_STATUS_BY_ERROR_CODE[code]).json(body);
  }

  /** `instanceof` alone narrows to `DomainError<any>`; this keeps the code in the closed set. */
  private isDomainError(value: unknown): value is DomainError {
    return value instanceof DomainError;
  }
}
