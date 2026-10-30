import { HEALTH_ROUTE, HealthResponse } from '@job-queue/contracts';
import { JobServiceUnavailableError } from '@job-queue/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaDatabase } from '../../src/infra/prisma/prisma-database.js';
import { JobGroupServiceUnderTest } from './job-group-service-under-test.js';

interface OpenApiDocument {
  openapi: string;
  info: { title: string };
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
}

describe('job-group-service health, docs and shutdown', () => {
  let service: JobGroupServiceUnderTest;

  beforeAll(async () => {
    service = await JobGroupServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterAll(async () => {
    await service.close();
  });

  describe('health', () => {
    it('job-group-service running', async () => {
      const response = await fetch(service.url(HEALTH_ROUTE.path));

      expect(response.status).toBe(200);
      expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok' });
    });

    it('job-group-service healthy while job-service is down', async () => {
      service.childJobs.count.mockRejectedValueOnce(
        new JobServiceUnavailableError({ reason: 'connect ECONNREFUSED' }),
      );

      const response = await fetch(service.url(HEALTH_ROUTE.path));

      expect(response.status).toBe(200);
      expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok' });
      expect(service.childJobs.count).not.toHaveBeenCalled();
    });

    it('job-group-service stopped', async () => {
      const stopping = await JobGroupServiceUnderTest.start();
      const databaseClose = vi.spyOn(stopping.app.get(PrismaDatabase), 'close');
      const health = stopping.url(HEALTH_ROUTE.path);
      expect((await fetch(health)).status).toBe(200);

      await stopping.close();

      expect(databaseClose).toHaveBeenCalledOnce();
      await expect(fetch(health)).rejects.toThrow();
    }, 180_000);
  });

  describe('docs', () => {
    it('job-group-service docs available', async () => {
      const page = await fetch(service.url('/docs'));
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');

      const response = await fetch(service.url('/docs-json'));
      expect(response.status).toBe(200);
      const document = (await response.json()) as OpenApiDocument;

      expect(document.openapi).toMatch(/^3\./);
      expect(document.info.title).toBe('job-group-service');
      expect(Object.keys(document.paths[HEALTH_ROUTE.path]?.get?.responses ?? {})).toEqual(['200']);
    });
  });
});
