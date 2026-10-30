import { HEALTH_ROUTE, HealthResponse } from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobExecutionServiceUnderTest } from './job-execution-service-under-test.js';

describe('job-execution-service health, start and shutdown', () => {
  let service: JobExecutionServiceUnderTest;

  beforeAll(async () => {
    service = await JobExecutionServiceUnderTest.start();
  });
  beforeEach(() => {
    service.clear();
  });
  afterAll(async () => {
    service.stubIdleShutdown();
    await service.close();
  });

  it('job-execution-service running', async () => {
    const response = await fetch(service.url(HEALTH_ROUTE.path));

    expect(response.status).toBe(200);
    expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok' });
    // The health check reports only this process, never Redis or job-service.
    expect(service.redis.ping).not.toHaveBeenCalled();
    expect(service.jobs.get).not.toHaveBeenCalled();
  });

  // The app under test was configured from an environment with no database variable at all.
  it('Starts without database settings', async () => {
    expect((await fetch(service.url(HEALTH_ROUTE.path))).status).toBe(200);
  });

  // "Instance started" (the start log line) is the bootstrap's unit test; this checks what the
  // started app does.
  it('starts taking queue entries once the app has started', async () => {
    const starting = await JobExecutionServiceUnderTest.start();
    starting.stubIdleShutdown();
    await starting.close();

    expect(starting.consumer.start).toHaveBeenCalledExactlyOnceWith({
      execute: expect.any(Function) as unknown,
    });
  });

  it('job-execution-service stopped', async () => {
    const stopping = await JobExecutionServiceUnderTest.start();
    const health = stopping.url(HEALTH_ROUTE.path);
    expect((await fetch(health)).status).toBe(200);
    stopping.stubIdleShutdown();

    await stopping.close();

    expect(stopping.consumer.close).toHaveBeenCalledOnce();
    expect(stopping.redis.close).toHaveBeenCalledOnce();
    await expect(fetch(health)).rejects.toThrow();
  });
});
