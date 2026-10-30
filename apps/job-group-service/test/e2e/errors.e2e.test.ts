import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JOB_GROUP_SERVICE,
  type JobGroupService,
} from '../../src/domain/groups/job-group-service.js';

import { JobGroupServiceUnderTest } from './job-group-service-under-test.js';

describe('job-group-service error responses', () => {
  let service: JobGroupServiceUnderTest;

  beforeAll(async () => {
    service = await JobGroupServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('Unexpected failure in job-group-service', async () => {
    vi.spyOn(service.app.get<JobGroupService>(JOB_GROUP_SERVICE), 'get').mockRejectedValueOnce(
      new Error('connection pool exhausted at db-7'),
    );

    const response = await service.get(randomUUID());

    const body = await service.errorBody({ response, status: 500, code: 'INTERNAL_ERROR' });
    expect(body.details).toEqual({});
    expect(JSON.stringify(body)).not.toContain('db-7');
  });
});
