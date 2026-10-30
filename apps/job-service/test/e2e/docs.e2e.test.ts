import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from './support/dependencies.js';
import { InProcessJobService } from './support/in-process-job-service.js';
import { JOB_SERVICE_TEST_ENV } from './support/running-job-service.js';

interface OpenApiOperation {
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
  requestBody?: { content: Record<string, { schema?: unknown }> };
  parameters?: { name: string; in: string }[];
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, unknown> };
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

  it('Docs list the job routes: submit, get, query and delete under /v1/jobs with their schemas', async () => {
    const response = await fetch(service.url({ path: '/docs-json' }).url);
    const { paths } = (await response.json()) as OpenApiDocument;
    const jobs = paths['/v1/jobs'];
    const job = paths['/v1/jobs/{id}'];

    expect(jobs?.post?.requestBody?.content['application/json']?.schema).toBeDefined();
    expect(jobs?.post?.responses['201']?.content?.['application/json']?.schema).toBeDefined();
    expect(jobs?.get?.parameters?.map((parameter) => parameter.name).sort()).toEqual([
      'limit',
      'offset',
    ]);
    expect(jobs?.get?.responses['200']?.content?.['application/json']?.schema).toBeDefined();
    expect(job?.get?.responses['200']?.content?.['application/json']?.schema).toBeDefined();
    expect(job?.get?.parameters?.map((parameter) => parameter.name)).toEqual(['id']);
    expect(Object.keys(job?.delete?.responses ?? {})).toContain('204');
    expect(Object.keys(paths).filter((path) => path.startsWith('/internal'))).toEqual([]);
  });

  it('Docs list the job routes: the submit body and the job schema include the webhook job type', async () => {
    const response = await fetch(service.url({ path: '/docs-json' }).url);
    const { paths, components } = (await response.json()) as OpenApiDocument;
    const submit = paths['/v1/jobs']?.post;
    const schemas = JSON.stringify({ submit, components });

    expect(submit?.requestBody?.content['application/json']?.schema).toBeDefined();
    expect(schemas).toContain('"webhook"');
    expect(schemas).toContain('"responseBody"');
    const refs = [...schemas.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    const missing = refs.filter((name) => !Object.hasOwn(components?.schemas ?? {}, name));
    expect(missing).toEqual([]);
  });
});
