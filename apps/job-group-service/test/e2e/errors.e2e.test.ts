import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobGroupServiceUnderTest } from './job-group-service-under-test.js';

describe('job-group-service error responses', () => {
  let service: JobGroupServiceUnderTest;

  beforeAll(async () => {
    service = await JobGroupServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterAll(async () => {
    await service.close();
  });

  it('Unknown route on job-group-service', async () => {
    const response = await fetch(service.url('/v1/nowhere'));

    const body = await service.errorBody({ response, status: 404, code: 'ROUTE_NOT_FOUND' });
    expect(body.details).toEqual({});
  });

  it('answers an unknown route with a body the same way, ignoring the body', async () => {
    const response = await fetch(service.url('/v1/nowhere'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });

    await service.errorBody({ response, status: 404, code: 'ROUTE_NOT_FOUND' });
  });
});
