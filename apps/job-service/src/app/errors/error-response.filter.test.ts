import { ErrorBody } from '@job-queue/contracts';
import { DomainError } from '@job-queue/kernel';
import { type ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MalformedBodyError } from '../../domain/http/malformed-body.error.js';
import { PayloadTooLargeError } from '../../domain/http/payload-too-large.error.js';
import { JobNotFoundError } from '../../domain/jobs/errors/job-not-found.error.js';
import { JobQueueUnavailableError } from '../../domain/jobs/errors/job-queue-unavailable.error.js';
import { JobStatusConflictError } from '../../domain/jobs/errors/job-status-conflict.error.js';
import { ErrorResponseFilter } from './error-response.filter.js';

class InternalAccessDenied extends DomainError<'INTERNAL_UNAUTHORIZED'> {
  constructor() {
    super({
      code: 'INTERNAL_UNAUTHORIZED',
      message: 'Internal access denied',
      details: { route: '/internal/v1/ping' },
    });
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
    const id = '7b0f5a3e-2c4d-4e8f-9a1b-3c5d7e9f1a2b';
    const cases = [
      { error: new JobNotFoundError({ id }), status: 404 },
      { error: new JobStatusConflictError({ id, status: 'processing' }), status: 409 },
      { error: new JobQueueUnavailableError({ jobId: id, attempt: 1 }), status: 503 },
    ];

    for (const { error, status } of cases) {
      new ErrorResponseFilter().catch(error, host);

      expect(reply.status).toBe(status);
      expect(ErrorBody.parse(reply.body)).toMatchObject({
        code: error.code,
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
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.any(String),
    );
  });

  it('maps a framework NotFoundException to 404 ROUTE_NOT_FOUND', () => {
    new ErrorResponseFilter().catch(new NotFoundException('Cannot GET /nowhere'), host);

    expect(reply.status).toBe(404);
    expect(ErrorBody.parse(reply.body).code).toBe('ROUTE_NOT_FOUND');
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
    expect(body.details).toEqual({ issues: [expect.objectContaining({ path: ['name'] })] });
  });

  it('maps a PayloadTooLargeError to 413 PAYLOAD_TOO_LARGE with the limit', () => {
    new ErrorResponseFilter().catch(new PayloadTooLargeError({ limitBytes: 2048 }), host);

    expect(reply.status).toBe(413);
    expect(ErrorBody.parse(reply.body)).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      details: { limitBytes: 2048 },
    });
  });

  it('maps a MalformedBodyError to 400 VALIDATION_FAILED', () => {
    new ErrorResponseFilter().catch(new MalformedBodyError(), host);

    expect(reply.status).toBe(400);
    expect(ErrorBody.parse(reply.body).code).toBe('VALIDATION_FAILED');
  });

  it('treats any other framework HTTP exception as unexpected: 500 INTERNAL_ERROR, logged', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementationOnce(() => undefined);

    new ErrorResponseFilter().catch(new BadRequestException('Some framework detail'), host);

    expect(reply.status).toBe(500);
    expect(ErrorBody.parse(reply.body)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    });
    expect(logged).toHaveBeenCalledOnce();
  });
});
