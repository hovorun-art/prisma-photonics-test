import { ErrorBody, SERVICE_TOKEN_SCHEME } from '@job-queue/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from './support/dependencies.js';
import { InProcessJobService } from './support/in-process-job-service.js';
import {
  INTERNAL_PROBE_ANSWER,
  INTERNAL_PROBE_PATH,
  InternalProbeModule,
} from './support/internal-probe.module.js';
import { JOB_SERVICE_TEST_ENV } from './support/running-job-service.js';

/** The spec's prefix: no route under it may appear in the docs, whatever its version. */
const INTERNAL_ROUTE_PREFIX = '/internal';
const CONFIGURED_TOKEN = 'e2e-internal-access-token';

interface OpenApiDocument {
  paths: Record<string, unknown>;
}

describe('job-service internal access (the real app over HTTP)', () => {
  let service: InProcessJobService;

  beforeAll(async () => {
    // The probe route needs no database or queue store.
    ({ service } = await InProcessJobService.start({
      env: {
        ...JOB_SERVICE_TEST_ENV,
        DATABASE_URL: UNREACHABLE_DATABASE_URL,
        REDIS_URL: UNREACHABLE_REDIS_URL,
        INTERNAL_SERVICE_TOKEN: CONFIGURED_TOKEN,
      },
      extraModules: [InternalProbeModule],
    }));
  });

  afterAll(async () => {
    await service.close();
  });

  it('Missing token: an /internal route called without a service token answers 401 INTERNAL_UNAUTHORIZED', async () => {
    const response = await fetch(service.url({ path: INTERNAL_PROBE_PATH }).url);

    expect(response.status).toBe(401);
    expect(ErrorBody.parse(await response.json()).code).toBe('INTERNAL_UNAUTHORIZED');
  });

  it('Wrong token: an /internal route called with a different token answers 401 INTERNAL_UNAUTHORIZED', async () => {
    const response = await fetch(service.url({ path: INTERNAL_PROBE_PATH }).url, {
      headers: { authorization: `${SERVICE_TOKEN_SCHEME} not-the-configured-token` },
    });

    expect(response.status).toBe(401);
    expect(ErrorBody.parse(await response.json()).code).toBe('INTERNAL_UNAUTHORIZED');
  });

  it('Valid token: an /internal route called with the configured token runs and answers normally', async () => {
    const response = await fetch(service.url({ path: INTERNAL_PROBE_PATH }).url, {
      headers: { authorization: `${SERVICE_TOKEN_SCHEME} ${CONFIGURED_TOKEN}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(INTERNAL_PROBE_ANSWER);
  });

  it('Docs exclude internal routes: the documentation lists no route under /internal', async () => {
    const response = await fetch(service.url({ path: '/docs-json' }).url);
    const paths = Object.keys(((await response.json()) as OpenApiDocument).paths);

    expect(response.status).toBe(200);
    expect(paths).toContain('/health');
    expect(paths).not.toContain(INTERNAL_PROBE_PATH);
    expect(paths.filter((path) => path.startsWith(INTERNAL_ROUTE_PREFIX))).toEqual([]);
  });
});
