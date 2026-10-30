import type { INestApplication } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JOB_SERVICE_CONFIG } from '../../domain/config/job-service-config.js';
import { MalformedBodyError } from '../../domain/http/malformed-body.error.js';
import { PayloadTooLargeError } from '../../domain/http/payload-too-large.error.js';
import { UnsupportedMediaTypeError } from '../../domain/http/unsupported-media-type.error.js';
import { RequestBodySetupStep } from './request-body-setup-step.js';

type ErrorMiddleware = (
  error: unknown,
  req: unknown,
  res: unknown,
  next: (e?: unknown) => void,
) => void;

describe('RequestBodySetupStep', () => {
  const setup = () => {
    const useBodyParser = vi.fn();
    const use = vi.fn();
    const get = vi.fn((token: symbol) =>
      token === JOB_SERVICE_CONFIG ? { bodyLimitBytes: 2048 } : undefined,
    );
    new RequestBodySetupStep().apply({
      app: { get, useBodyParser, use } as unknown as INestApplication,
    });
    const middleware = use.mock.calls[0]?.[0] as ErrorMiddleware;
    const pass = (error: unknown): unknown => {
      const next = vi.fn();
      middleware(error, {}, {}, next);
      return next.mock.calls[0]?.[0];
    };
    return { useBodyParser, pass };
  };

  it('sets the configured body limit on the JSON and form body parsers', () => {
    const { useBodyParser } = setup();

    expect(useBodyParser).toHaveBeenCalledWith('json', { limit: 2048 });
    expect(useBodyParser).toHaveBeenCalledWith('urlencoded', { limit: 2048, extended: true });
  });

  it('turns an invalid-JSON body parser error into MalformedBodyError', () => {
    expect(setup().pass({ type: 'entity.parse.failed' })).toBeInstanceOf(MalformedBodyError);
  });

  it('turns a too-large body parser error into PayloadTooLargeError carrying the limit', () => {
    const mapped = setup().pass({ type: 'entity.too.large', limit: 2048 });

    expect(mapped).toBeInstanceOf(PayloadTooLargeError);
    expect((mapped as PayloadTooLargeError).details).toEqual({ limitBytes: 2048 });
  });

  it('turns a body that cannot be decompressed into MalformedBodyError', () => {
    const decompression = Object.assign(new Error('Decompression failed'), { status: 400 });

    expect(setup().pass(decompression)).toBeInstanceOf(MalformedBodyError);
  });

  it('turns an unsupported content encoding or charset into UnsupportedMediaTypeError', () => {
    for (const type of ['encoding.unsupported', 'charset.unsupported']) {
      expect(setup().pass({ type })).toBeInstanceOf(UnsupportedMediaTypeError);
    }
  });

  it('passes any other error on untouched', () => {
    const other = new Error('boom');

    expect(setup().pass(other)).toBe(other);
  });
});
