import { HealthResponse } from '@job-queue/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from './support/dependencies.js';
import { InProcessJobService } from './support/in-process-job-service.js';
import { JOB_SERVICE_TEST_ENV } from './support/running-job-service.js';

describe('GET /health (job-service over HTTP)', () => {
  let service: InProcessJobService;

  beforeAll(async () => {
    // The health check probes nothing, so it answers even with no database or queue store.
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

  it('job-service running: answers 200 with { "status": "ok" }', async () => {
    const response = await fetch(service.url({ path: '/health' }).url);

    expect(response.status).toBe(200);
    expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok' });
  });
});
