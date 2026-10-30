import { randomUUID } from 'node:crypto';

import { ErrorBody } from '@job-queue/contracts';
import {
  DomainError,
  ERROR_CODES,
  type ErrorCode,
  JobNotFoundError,
  JobServiceUnavailableError,
  JobStatusConflictError,
  VALIDATION_FAILED_MESSAGE,
} from '@job-queue/kernel';
import { type ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ErrorResponseFilter, HTTP_STATUS_BY_ERROR_CODE } from './error-response.filter.js';

class InternalAccessDenied extends DomainError<'INTERNAL_UNAUTHORIZED'> {
  constructor() {
    super({
      code: 'INTERNAL_UNAUTHORIZED',
      message: 'Internal access denied',
      details: { route: '/internal/v1/ping' },
    });
  }
}

/** A failure of any code, standing in for the services' own error classes. */
class CodedError extends DomainError {
  constructor(code: ErrorCode, details: Record<string, unknown> = {}) {
    super({ code, message: `${code} happened`, details });
  }
}

describe('ErrorResponseFilter', () => {
  /** What the filter sent through the HTTP response. */
  let reply: { status?: number; body?: unknown };
  let host: ArgumentsHost;

  beforeEach(() => {
    reply = {};
    const response = {
      status: (code: number) => {
        reply.status = code;
        return response;
      },
      json: (body: unknown) => {
        reply.body = body;
        return response;
      },
    };
    host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a DomainError to the status of its code and the body {code, message, details}', () => {
    new ErrorResponseFilter().catch(new InternalAccessDenied(), host);

    expect(reply.status).toBe(401);
    expect(ErrorBody.parse(reply.body)).toEqual({
      code: 'INTERNAL_UNAUTHORIZED',
      message: 'Internal access denied',
      details: { route: '/internal/v1/ping' },
    });
  });

  it('maps the job errors to 404, 409 and 503 with their details', () => {
    const id = randomUUID();
    const cases = [
      { error: new JobNotFoundError({ id }), status: 404 },
      { error: new JobStatusConflictError({ id, status: 'processing' }), status: 409 },
      { error: new CodedError('QUEUE_UNAVAILABLE', { jobId: id, attempt: 1 }), status: 503 },
      { error: new JobServiceUnavailableError({ reason: 'HTTP 502' }), status: 503 },
    ];

    for (const { error, status } of cases) {
      new ErrorResponseFilter().catch(error, host);

      expect(reply.status).toBe(status);
      expect(ErrorBody.parse(reply.body)).toEqual({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
  });

  it('maps the job group errors to 404 and 409 with their details', () => {
    const id = randomUUID();
    const cases = [
      { error: new CodedError('JOB_GROUP_NOT_FOUND', { id }), status: 404 },
      { error: new CodedError('JOB_GROUP_NOT_EMPTY', { id, total: 3 }), status: 409 },
    ];

    for (const { error, status } of cases) {
      new ErrorResponseFilter().catch(error, host);

      expect(reply.status).toBe(status);
      expect(ErrorBody.parse(reply.body)).toEqual({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
  });

  it('maps an unknown error to 500 INTERNAL_ERROR without leaking it, and logs it', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementationOnce(() => undefined);
    const failure = new Error('connection pool exhausted');

    new ErrorResponseFilter().catch(failure, host);

    expect(reply.status).toBe(500);
    expect(ErrorBody.parse(reply.body)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    });
    expect(JSON.stringify(reply.body)).not.toContain('connection pool exhausted');
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: failure }),
      expect.any(String),
    );
  });

  it('maps a framework NotFoundException to 404 ROUTE_NOT_FOUND', () => {
    new ErrorResponseFilter().catch(new NotFoundException('Cannot GET /nowhere'), host);

    expect(reply.status).toBe(404);
    expect(ErrorBody.parse(reply.body)).toEqual({
      code: 'ROUTE_NOT_FOUND',
      message: 'Route not found',
      details: {},
    });
  });

  it('maps a Zod validation failure to 400 VALIDATION_FAILED with the issues and their paths', () => {
    const failure = z.object({ name: z.string() }).safeParse({ name: 1 });
    if (failure.success) {
      throw new Error('expected the parse to fail');
    }

    new ErrorResponseFilter().catch(new ZodValidationException(failure.error), host);

    expect(reply.status).toBe(400);
    const body = ErrorBody.parse(reply.body);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toBe(VALIDATION_FAILED_MESSAGE);
    expect(body.details).toEqual({ issues: [expect.objectContaining({ path: ['name'] })] });
  });

  it('maps UNSUPPORTED_MEDIA_TYPE to 415', () => {
    new ErrorResponseFilter().catch(new CodedError('UNSUPPORTED_MEDIA_TYPE'), host);

    expect(reply.status).toBe(415);
    expect(ErrorBody.parse(reply.body)).toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      details: {},
    });
  });

  it('maps PAYLOAD_TOO_LARGE to 413 with the limit', () => {
    new ErrorResponseFilter().catch(
      new CodedError('PAYLOAD_TOO_LARGE', { limitBytes: 2048 }),
      host,
    );

    expect(reply.status).toBe(413);
    expect(ErrorBody.parse(reply.body)).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      details: { limitBytes: 2048 },
    });
  });

  it('maps a VALIDATION_FAILED domain error to 400', () => {
    new ErrorResponseFilter().catch(new CodedError('VALIDATION_FAILED'), host);

    expect(reply.status).toBe(400);
    expect(ErrorBody.parse(reply.body).code).toBe('VALIDATION_FAILED');
  });

  it('maps a validation exception without Zod issues to 400 VALIDATION_FAILED with no issues', () => {
    new ErrorResponseFilter().catch(new ZodValidationException(new Error('not zod')), host);

    expect(reply.status).toBe(400);
    expect(ErrorBody.parse(reply.body)).toEqual({
      code: 'VALIDATION_FAILED',
      message: VALIDATION_FAILED_MESSAGE,
      details: { issues: [] },
    });
  });

  it('maps a domain error with any code of the closed list to that code status', () => {
    for (const code of ERROR_CODES) {
      new ErrorResponseFilter().catch(new CodedError(code), host);

      expect(reply.status).toBe(HTTP_STATUS_BY_ERROR_CODE[code]);
      expect(ErrorBody.parse(reply.body).code).toBe(code);
    }
  });

  it('treats any other framework HTTP exception as unexpected: 500 INTERNAL_ERROR, logged', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementationOnce(() => undefined);

    const exception = new BadRequestException('Some framework detail');

    new ErrorResponseFilter().catch(exception, host);

    expect(reply.status).toBe(500);
    expect(ErrorBody.parse(reply.body)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    });
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ err: exception }),
      expect.any(String),
    );
  });
});
