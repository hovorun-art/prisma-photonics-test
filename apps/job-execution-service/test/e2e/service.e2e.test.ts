import { HEALTH_ROUTE, HealthResponse } from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(starting.cancellations.listen).toHaveBeenCalledExactlyOnceWith({
      onCancel: expect.any(Function) as unknown,
    });
    // It listens before it takes entries, so no cancel of a job it starts is missed.
    expect(starting.cancellations.listen.mock.invocationCallOrder[0]).toBeLessThan(
      starting.consumer.start.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('starts and runs jobs even when it cannot listen for cancellations', async () => {
    const starting = await JobExecutionServiceUnderTest.start({
      listenFails: new Error('Redis is away'),
    });
    try {
      expect((await fetch(starting.url(HEALTH_ROUTE.path))).status).toBe(200);
      expect(starting.consumer.start).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(
          starting.logs.filter(
            (line) => line.level === 50 && line.msg === 'Could not listen for job cancellations',
          ),
        ).toHaveLength(1);
      });
    } finally {
      starting.stubIdleShutdown();
      await starting.close();
    }
  });

  it('job-execution-service stopped', async () => {
    const stopping = await JobExecutionServiceUnderTest.start();
    const health = stopping.url(HEALTH_ROUTE.path);
    expect((await fetch(health)).status).toBe(200);
    stopping.stubIdleShutdown();

    await stopping.close();

    expect(stopping.consumer.close).toHaveBeenCalledOnce();
    expect(stopping.cancellations.close).toHaveBeenCalledOnce();
    // Cancellations are heard until the running jobs are done.
    expect(stopping.consumer.close.mock.invocationCallOrder[0]).toBeLessThan(
      stopping.cancellations.close.mock.invocationCallOrder[0] ?? 0,
    );
    expect(stopping.redis.close).toHaveBeenCalledOnce();
    await expect(fetch(health)).rejects.toThrow();
  });
});
