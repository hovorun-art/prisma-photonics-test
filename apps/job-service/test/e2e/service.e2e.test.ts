import {
  HEALTH_ROUTE,
  HealthResponse,
  JOBS_BULK_ROUTE,
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
      expect(stopping.jobLogDestination.open).toHaveBeenCalledOnce();
      const databaseClose = vi.spyOn(stopping.app.get(PrismaDatabase), 'close');
      const health = stopping.url(HEALTH_ROUTE.path);
      expect((await fetch(health)).status).toBe(200);

      await stopping.close();

      expect(databaseClose).toHaveBeenCalledOnce();
      expect(stopping.queue.close).toHaveBeenCalledOnce();
      expect(stopping.redis.close).toHaveBeenCalledOnce();
      expect(stopping.jobLogDestination.close).toHaveBeenCalledOnce();
      expect(stopping.jobLogStoreMock?.close).toHaveBeenCalledOnce();
      expect(stopping.jobLogStream.close).toHaveBeenCalledOnce();
      const destinationClosed = stopping.jobLogDestination.close.mock.invocationCallOrder[0];
      expect(stopping.jobLogStoreMock?.close.mock.invocationCallOrder[0]).toBeLessThan(
        destinationClosed ?? 0,
      );
      expect(stopping.jobLogStream.close.mock.invocationCallOrder[0]).toBeLessThan(
        destinationClosed ?? 0,
      );
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
      // A replay answers 200 and a key reused for another job 409, so clients see both.
      expect(jobs?.post?.responses['200']?.content?.['application/json']?.schema).toBeDefined();
      expect(Object.keys(jobs?.post?.responses ?? {}).sort()).toEqual(['200', '201', '400', '409']);
      // The request schema, with the schemas it refers to, carries the idempotency key.
      const seen = new Set<string>();
      const texts = [JSON.stringify(jobs?.post?.requestBody?.content['application/json']?.schema)];
      for (const text of texts) {
        for (const [, name = ''] of text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) {
          if (seen.has(name)) continue;
          seen.add(name);
          texts.push(JSON.stringify(components?.schemas?.[name]));
        }
      }
      expect(texts.join(' ')).toContain('"idempotencyKey"');
      const bulk = paths[JOBS_BULK_ROUTE]?.post;
      expect(bulk?.requestBody?.content['application/json']?.schema).toBeDefined();
      expect(bulk?.responses['201']?.content?.['application/json']?.schema).toBeDefined();
      expect(bulk?.responses['200']?.content?.['application/json']?.schema).toBeDefined();
      expect(Object.keys(bulk?.responses ?? {}).sort()).toEqual([
        '200',
        '201',
        '400',
        '409',
        '413',
      ]);
      expect(jobs?.get?.parameters?.map((parameter) => parameter.name).sort()).toEqual([
        'groupId',
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
      // Status change: the cancel and retry body, the updated job and every error answer.
      expect(job?.patch?.parameters?.map((parameter) => parameter.name)).toEqual(['id']);
      expect(job?.patch?.requestBody?.content['application/json']?.schema).toBeDefined();
      expect(job?.patch?.responses['200']?.content?.['application/json']?.schema).toBeDefined();
      expect(Object.keys(job?.patch?.responses ?? {}).sort()).toEqual(['200', '400', '404', '409']);
      // The body schema itself (not the whole components, which hold every job status) allows
      // exactly the two target statuses.
      const bodySchema = job?.patch?.requestBody?.content['application/json']?.schema as
        { $ref?: string } | undefined;
      const bodyName = bodySchema?.$ref?.replace('#/components/schemas/', '') ?? '';
      const statusChange = JSON.stringify(components?.schemas?.[bodyName] ?? bodySchema);
      expect(statusChange).toContain('"cancelled"');
      expect(statusChange).toContain('"pending"');
      for (const other of ['completed', 'failed', 'processing', 'scheduled']) {
        expect(statusChange).not.toContain(`"${other}"`);
      }
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

    it('Log route in the API docs', async () => {
      const { paths, components } = await docs();
      const log = paths[`${JOBS_ROUTE}/{id}/logs`]?.get;
      const schema = log?.responses['200']?.content?.['application/json']?.schema as
        { $ref?: string } | undefined;
      const name = schema?.$ref?.replace('#/components/schemas/', '') ?? '';
      const resolved = components?.schemas?.[name] as
        { properties: Record<string, unknown> } | undefined;

      expect(log?.parameters?.map((parameter) => parameter.name).sort()).toEqual([
        'after',
        'id',
        'level',
        'limit',
      ]);
      expect(Object.keys(resolved?.properties ?? {}).sort()).toEqual(['items', 'nextCursor']);
    });

    it('Docs list the statistics route', async () => {
      const { paths, components } = await docs();
      const stats = paths[STATS_ROUTE]?.get;
      const schema = stats?.responses['200']?.content?.['application/json']?.schema as
        { $ref?: string } | undefined;
      const name = schema?.$ref?.replace('#/components/schemas/', '') ?? '';
      const resolved = components?.schemas?.[name] as
        { properties: Record<string, { properties?: Record<string, unknown> }> } | undefined;

      // One optional value per filter, so the parameters are single enums, not lists.
      const parameter = (name: string): unknown =>
        stats?.parameters?.find((candidate) => candidate.name === name);
      expect(stats?.parameters?.map((candidate) => candidate.name).sort()).toEqual([
        'groupId',
        'status',
        'type',
      ]);
      expect(parameter('status')).toMatchObject({
        in: 'query',
        required: false,
        schema: { type: 'string', enum: JobStatus.options },
      });
      expect(parameter('type')).toMatchObject({
        in: 'query',
        required: false,
        schema: { type: 'string', enum: JobType.options },
      });
      expect(Object.keys(resolved?.properties ?? {}).sort()).toEqual([
        'counts',
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
      const counts = resolved?.properties.counts?.properties as
        Record<string, { properties?: Record<string, unknown>; required?: string[] }> | undefined;
      expect(counts?.status?.required?.toSorted()).toEqual(JobStatus.options.toSorted());
      expect(counts?.type?.required?.toSorted()).toEqual(JobType.options.toSorted());
    });

    it('Docs exclude internal routes', async () => {
      const paths = Object.keys((await docs()).paths);

      expect(paths).toContain(HEALTH_ROUTE.path);
      expect(paths.filter((path) => path.startsWith('/internal'))).toEqual([]);
    });
  });
});
