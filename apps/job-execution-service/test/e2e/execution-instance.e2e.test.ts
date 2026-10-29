import { fileURLToPath } from 'node:url';

import { HealthResponse } from '@job-queue/contracts';
import {
  ClientListRedisConnectionCounter,
  CONTAINER_IMAGES,
  NodeServiceLauncher,
  NpmServiceBuild,
  type RedisConnectionCounter,
  type SpawnedService,
} from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * job-execution-service as a black box: the compiled process and a real Redis (Testcontainers).
 */

/** The name the service gives its connection (`CLIENT SETNAME`). */
const CONNECTION_NAME = 'job-execution-service';
const POLL = { timeout: 15_000, interval: 100 };

describe('job-execution-service', () => {
  let redisContainer: StartedRedisContainer;
  let connections: RedisConnectionCounter;
  /** The environment an instance starts with: Redis, but no database setting. */
  let env: Record<string, string>;
  let instance: SpawnedService | undefined;
  const launcher = new NodeServiceLauncher({
    appRoot,
    portVariable: 'JOB_EXECUTION_SERVICE_PORT',
    serviceName: 'job-execution-service',
  });

  beforeAll(async () => {
    [redisContainer] = await Promise.all([
      new RedisContainer(CONTAINER_IMAGES.redis).start(),
      new NpmServiceBuild({ repoRoot, workspace: '@job-queue/job-execution-service' }).build(),
    ]);
    connections = new ClientListRedisConnectionCounter({
      redisUrl: redisContainer.getConnectionUrl(),
    });
  });
  afterAll(async () => {
    await connections.close();
    await redisContainer.stop();
  });
  beforeEach(() => {
    env = { NODE_ENV: 'test', LOG_LEVEL: 'info', REDIS_URL: redisContainer.getConnectionUrl() };
  });
  afterEach(() => {
    instance?.kill();
    instance = undefined;
  });

  function instanceId(running: SpawnedService): string | undefined {
    const id = running.logs.find((line) => typeof line.instanceId === 'string')?.instanceId;
    return typeof id === 'string' ? id : undefined;
  }

  async function openConnections(): Promise<number> {
    return (await connections.count({ name: CONNECTION_NAME })).connections;
  }

  it('job-execution-service running: GET /health answers 200 with { "status": "ok" }', async () => {
    const { service: running } = await launcher.start({ env });
    instance = running;

    const response = await fetch(running.url({ path: '/health' }).url);

    expect(response.status).toBe(200);
    expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok' });
  });

  it('Instance started: logs that it has started, with its instance id, once connected to Redis', async () => {
    const { service: running } = await launcher.start({ env });
    instance = running;

    await expect
      .poll(
        () =>
          running.logs.some(
            (line) => line.msg?.startsWith('job-execution-service started') === true,
          ),
        POLL,
      )
      .toBe(true);

    expect(instanceId(running)).toEqual(expect.any(String));
    expect(await openConnections()).toBe(1);
    expect(running.logs.every((line) => line.instanceId === instanceId(running))).toBe(true);
  });

  it('Starts without database settings: starts and answers its health check', async () => {
    expect(Object.keys(env).filter((name) => /DATABASE|POSTGRES/.test(name))).toEqual([]);

    const { service: running } = await launcher.start({ env });
    instance = running;

    expect((await fetch(running.url({ path: '/health' }).url)).status).toBe(200);
  });

  it('job-execution-service stopped: on SIGTERM it closes its connections and exits with a success code', async () => {
    const { service: running } = await launcher.start({ env });
    instance = running;
    expect(await openConnections()).toBe(1);

    const { exitCode } = await running.stop({ signal: 'SIGTERM' });

    expect(exitCode).toBe(0);
    expect(await openConnections()).toBe(0);
  });
});
