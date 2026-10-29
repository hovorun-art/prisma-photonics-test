import { fileURLToPath } from 'node:url';

import { NodeServiceLauncher, NpmServiceBuild, type SpawnedService } from '@job-queue/test-support';
import type { MockInstance } from 'vitest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../src/domain/database/database.js';
import { ContainerDependencies } from './support/container-dependencies.js';
import { DatabaseCloseProbeModule } from './support/database-close-probe.module.js';
import { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from './support/dependencies.js';
import { InProcessJobService } from './support/in-process-job-service.js';
import { JOB_SERVICE_TEST_ENV } from './support/running-job-service.js';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** The names job-service gives its connections (`application_name`, `CLIENT SETNAME`). */
const CONNECTION_NAME = 'job-service';

describe('Graceful shutdown (job-service as its own process)', () => {
  let dependencies: ContainerDependencies;
  let service: SpawnedService | undefined;
  const launcher = new NodeServiceLauncher({
    appRoot,
    portVariable: 'JOB_SERVICE_PORT',
    serviceName: 'job-service',
  });

  beforeAll(async () => {
    [{ dependencies }] = await Promise.all([
      ContainerDependencies.start(),
      new NpmServiceBuild({ repoRoot, workspace: '@job-queue/job-service' }).build(),
    ]);
  });

  afterEach(() => {
    // Never leave a process behind when an assertion fails before the stop.
    service?.kill();
    service = undefined;
  });

  afterAll(async () => {
    await dependencies.stop();
  });

  it('job-service stopped: on SIGTERM it closes its connections and exits with a success code', async () => {
    ({ service } = await launcher.start({
      env: {
        ...JOB_SERVICE_TEST_ENV,
        DATABASE_URL: dependencies.databaseUrl,
        REDIS_URL: dependencies.redisUrl,
      },
    }));
    expect((await fetch(service.url({ path: '/health' }).url)).status).toBe(200);
    const open = await dependencies.openConnections({ name: CONNECTION_NAME });
    // The database pool connects on first use, and nothing queries it yet; Redis connects at once.
    expect(open.redis).toBe(1);

    await expect(service.stop({ signal: 'SIGTERM' })).resolves.toEqual({
      exitCode: 0,
      signal: null,
    });

    await expect(dependencies.openConnections({ name: CONNECTION_NAME })).resolves.toEqual({
      database: 0,
      redis: 0,
    });
  });
});

describe('Graceful shutdown (job-service in the test process)', () => {
  it('job-service stopped: closes the database on shutdown', async () => {
    // The database pool is lazy, so open connections cannot show the close; watch the call itself.
    let close: MockInstance<Database['close']> | undefined;
    const { service } = await InProcessJobService.start({
      env: {
        ...JOB_SERVICE_TEST_ENV,
        DATABASE_URL: UNREACHABLE_DATABASE_URL,
        REDIS_URL: UNREACHABLE_REDIS_URL,
      },
      extraModules: [DatabaseCloseProbeModule.forRoot({ onSpy: (spy) => (close = spy) })],
    });
    expect(close).toHaveBeenCalledTimes(0);

    await service.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
