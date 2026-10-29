import { HealthResponse } from '@job-queue/contracts';
import { expect, test } from '@playwright/test';

import { JOB_SERVICE_URL } from './support/stack-settings.js';

interface OpenApiDocument {
  paths: Record<string, unknown>;
}

test('job-service running: GET /health answers 200 and the body passes HealthResponse', async ({
  request,
}) => {
  const response = await request.get(`${JOB_SERVICE_URL}/health`);

  expect(response.status()).toBe(200);
  expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok' });
});

test('API docs available: the docs route answers and lists no /internal path', async ({
  request,
}) => {
  const page = await request.get(`${JOB_SERVICE_URL}/docs`);
  const document = await request.get(`${JOB_SERVICE_URL}/docs-json`);

  expect(page.status()).toBe(200);
  expect(document.status()).toBe(200);
  const paths = Object.keys(((await document.json()) as OpenApiDocument).paths);
  expect(paths).toContain('/health');
  expect(paths.filter((path) => path.startsWith('/internal'))).toEqual([]);
});
