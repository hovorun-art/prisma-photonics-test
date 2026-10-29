import { ErrorBody } from '@job-queue/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from './support/dependencies.js';
import {
  ErrorProbeModule,
  FAILURE_PROBE_PATH,
  VALIDATION_PROBE_PATH,
} from './support/error-probe.module.js';
import { InProcessJobService } from './support/in-process-job-service.js';
import { InternalProbeModule, INTERNAL_PROBE_PATH } from './support/internal-probe.module.js';
import { JOB_SERVICE_TEST_ENV } from './support/running-job-service.js';

const BODY_LIMIT_BYTES = 1024;

describe('job-service error responses (the real app over HTTP)', () => {
  let service: InProcessJobService;

  beforeAll(async () => {
    ({ service } = await InProcessJobService.start({
      env: {
        ...JOB_SERVICE_TEST_ENV,
        DATABASE_URL: UNREACHABLE_DATABASE_URL,
        REDIS_URL: UNREACHABLE_REDIS_URL,
        JOB_SERVICE_BODY_LIMIT_BYTES: String(BODY_LIMIT_BYTES),
      },
      extraModules: [InternalProbeModule, ErrorProbeModule],
    }));
  });

  afterAll(async () => {
    await service.close();
  });

  it('Known failure: an expected failure answers with its code, a message and a details object', async () => {
    const response = await fetch(service.url({ path: INTERNAL_PROBE_PATH }).url);

    expect(response.status).toBe(401);
    const body = ErrorBody.parse(await response.json());
    expect(body.code).toBe('INTERNAL_UNAUTHORIZED');
    expect(body.message).not.toBe('');
    expect(body.details).toEqual(expect.any(Object));
  });

  it('Unexpected failure: answers 500 INTERNAL_ERROR with no internal information', async () => {
    const response = await fetch(service.url({ path: FAILURE_PROBE_PATH }).url);

    expect(response.status).toBe(500);
    const text = await response.text();
    const body = ErrorBody.parse(JSON.parse(text));
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.details).toEqual({});
    expect(text).not.toContain('secret internals');
  });

  it('Unknown route: answers 404 ROUTE_NOT_FOUND in the error body', async () => {
    const response = await fetch(service.url({ path: '/no-such-route' }).url);

    expect(response.status).toBe(404);
    const body = ErrorBody.parse(await response.json());
    expect(body.code).toBe('ROUTE_NOT_FOUND');
    expect(body.message).not.toBe('');
  });

  it('Invalid request: answers 400 VALIDATION_FAILED listing each issue with its field', async () => {
    const response = await fetch(service.url({ path: VALIDATION_PROBE_PATH }).url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', size: 'big' }),
    });

    expect(response.status).toBe(400);
    const body = ErrorBody.parse(await response.json());
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual({
      issues: [
        expect.objectContaining({ path: ['name'] }),
        expect.objectContaining({ path: ['size'] }),
      ],
    });
  });

  it('Malformed body: a body that is not valid JSON answers 400 VALIDATION_FAILED', async () => {
    const response = await fetch(service.url({ path: VALIDATION_PROBE_PATH }).url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name": ',
    });

    expect(response.status).toBe(400);
    const text = await response.text();
    const body = ErrorBody.parse(JSON.parse(text));
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).not.toBe('');
    expect(body.details).toEqual(expect.any(Object));
  });

  it('Body too large: a body over the configured limit answers 413 PAYLOAD_TOO_LARGE with the limit', async () => {
    const response = await fetch(service.url({ path: VALIDATION_PROBE_PATH }).url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(BODY_LIMIT_BYTES * 2), size: 1 }),
    });

    expect(response.status).toBe(413);
    const body = ErrorBody.parse(await response.json());
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.details).toEqual({ limitBytes: BODY_LIMIT_BYTES });
  });
});
