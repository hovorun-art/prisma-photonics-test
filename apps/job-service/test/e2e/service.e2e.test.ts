import {
  HEALTH_ROUTE,
  HealthResponse,
  JOBS_ROUTE,
  JobStatus,
  JobType,
  STATS_ROUTE,
} from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaDatabase } from '../../src/infra/prisma/prisma-database.js';
import { JobServiceUnderTest } from './job-service-under-test.js';

interface OpenApiOperation {
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
  requestBody?: { content: Record<string, { schema?: unknown }> };
  parameters?: { name: string; in: string; schema?: unknown }[];
}

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, unknown> };
}

describe('job-service health, docs and shutdown', () => {
  let service: JobServiceUnderTest;

  const docs = async (): Promise<OpenApiDocument> => {
    const response = await fetch(service.url('/docs-json'));
    expect(response.status).toBe(200);
    return (await response.json()) as OpenApiDocument;
  };

  beforeAll(async () => {
    service = await JobServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterAll(async () => {
    await service.close();
  });

  describe('health', () => {
    it('job-service running', async () => {
      const response = await fetch(service.url(HEALTH_ROUTE.path));

      expect(response.status).toBe(200);
      expect(HealthResponse.parse(await response.json())).toEqual({ status: 'ok' });
      expect(service.redis.ping).not.toHaveBeenCalled();
    });

    it('job-service stopped', async () => {
      const stopping = await JobServiceUnderTest.start();
      const databaseClose = vi.spyOn(stopping.app.get(PrismaDatabase), 'close');
      const health = stopping.url(HEALTH_ROUTE.path);
      expect((await fetch(health)).status).toBe(200);

      await stopping.close();

      expect(databaseClose).toHaveBeenCalledOnce();
      expect(stopping.queue.close).toHaveBeenCalledOnce();
      expect(stopping.redis.close).toHaveBeenCalledOnce();
      await expect(fetch(health)).rejects.toThrow();
    }, 180_000);
  });

  describe('docs', () => {
    it('Docs available', async () => {
      const page = await fetch(service.url('/docs'));
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');

      const document = await docs();

      expect(document.openapi).toMatch(/^3\./);
      expect(Object.keys(document.paths[HEALTH_ROUTE.path]?.get?.responses ?? {})).toEqual(['200']);
    });

    it('Docs list the job routes', async () => {
      const { paths, components } = await docs();
      const jobs = paths[JOBS_ROUTE];
      const job = paths[`${JOBS_ROUTE}/{id}`];

      expect(jobs?.post?.requestBody?.content['application/json']?.schema).toBeDefined();
      expect(jobs?.post?.responses['201']?.content?.['application/json']?.schema).toBeDefined();
      expect(jobs?.get?.parameters?.map((parameter) => parameter.name).sort()).toEqual([
        'limit',
        'offset',
        'status',
        'type',
      ]);
      // The filters are lists of the known values, so clients see what they may repeat.
      const parameter = (name: string): unknown =>
        jobs?.get?.parameters?.find((candidate) => candidate.name === name);
      expect(parameter('status')).toMatchObject({
        in: 'query',
        schema: { type: 'array', items: { type: 'string', enum: JobStatus.options } },
      });
      expect(parameter('type')).toMatchObject({
        in: 'query',
        schema: { type: 'array', items: { type: 'string', enum: JobType.options } },
      });
      expect(jobs?.get?.responses['200']?.content?.['application/json']?.schema).toBeDefined();
      expect(job?.get?.responses['200']?.content?.['application/json']?.schema).toBeDefined();
      expect(job?.get?.parameters?.map((parameter) => parameter.name)).toEqual(['id']);
      expect(Object.keys(job?.delete?.responses ?? {})).toContain('204');
      // Every job type is in the submit body and the job schema, and every reference resolves.
      const schemas = JSON.stringify({ submit: jobs?.post, components });
      expect(schemas).toContain('"email"');
      expect(schemas).toContain('"webhook"');
      expect(schemas).toContain('"responseBody"');
      const refs = [...schemas.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map(
        (match) => match[1] ?? '',
      );
      expect(refs.filter((name) => !Object.hasOwn(components?.schemas ?? {}, name))).toEqual([]);
    });

    it('Docs list the statistics route', async () => {
      const { paths, components } = await docs();
      const stats = paths[STATS_ROUTE]?.get;
      const schema = stats?.responses['200']?.content?.['application/json']?.schema as
        { $ref?: string } | undefined;
      const name = schema?.$ref?.replace('#/components/schemas/', '') ?? '';
      const resolved = components?.schemas?.[name] as
        { properties: Record<string, { properties?: Record<string, unknown> }> } | undefined;

      expect(stats?.parameters ?? []).toEqual([]);
      expect(Object.keys(resolved?.properties ?? {}).sort()).toEqual([
        'pending',
        'processing',
        'recent',
        'scheduled',
        'throughput',
      ]);
      expect(Object.keys(resolved?.properties.recent?.properties ?? {}).sort()).toEqual([
        'completed',
        'failed',
        'windowMinutes',
      ]);
      expect(Object.keys(resolved?.properties.throughput?.properties ?? {}).sort()).toEqual([
        'perMinute',
        'windowMinutes',
      ]);
    });

    it('Docs exclude internal routes', async () => {
      const paths = Object.keys((await docs()).paths);

      expect(paths).toContain(HEALTH_ROUTE.path);
      expect(paths.filter((path) => path.startsWith('/internal'))).toEqual([]);
    });
  });
});
