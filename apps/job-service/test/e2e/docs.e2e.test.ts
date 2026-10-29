import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from './support/dependencies.js';
import { InProcessJobService } from './support/in-process-job-service.js';
import { JOB_SERVICE_TEST_ENV } from './support/running-job-service.js';

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
}

describe('API documentation (job-service over HTTP)', () => {
  let service: InProcessJobService;

  beforeAll(async () => {
    // The docs need no database or queue store.
    ({ service } = await InProcessJobService.start({
      env: {
        ...JOB_SERVICE_TEST_ENV,
        DATABASE_URL: UNREACHABLE_DATABASE_URL,
        REDIS_URL: UNREACHABLE_REDIS_URL,
      },
    }));
  });

  afterAll(async () => {
    await service.close();
  });

  it('Docs available: the documentation route serves the Swagger UI', async () => {
    const response = await fetch(service.url({ path: '/docs' }).url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('Docs available: the OpenAPI document includes GET /health', async () => {
    const response = await fetch(service.url({ path: '/docs-json' }).url);
    const document = (await response.json()) as OpenApiDocument;

    expect(response.status).toBe(200);
    expect(document.openapi).toMatch(/^3\./);
    expect(Object.keys(document.paths['/health']?.get?.responses ?? {})).toEqual(['200']);
  });
});
