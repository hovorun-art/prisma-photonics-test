import { randomUUID } from 'node:crypto';

import {
  EMAIL_LIMITS,
  ErrorBody,
  JOB_LIMITS,
  JOBS_ROUTE,
  Job,
  QueryJobsResponse,
} from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ContainerDependencies } from './support/container-dependencies.js';
import { UNREACHABLE_REDIS_URL } from './support/dependencies.js';
import { InProcessJobService } from './support/in-process-job-service.js';
import { ContainerJobFixtures } from './support/job-fixtures.js';
import { JOB_SERVICE_TEST_ENV } from './support/running-job-service.js';

const QUERY_DEFAULT_LIMIT = 3;
const QUERY_MAX_LIMIT = 10;
const UNKNOWN_ID = randomUUID();

const EMAIL_JOB = {
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
  priority: 7,
  maxAttempts: 4,
};

const WEBHOOK_JOB = {
  type: 'webhook',
  payload: {
    method: 'POST',
    url: 'https://hooks.example.com/orders',
    body: { orderId: 'ord_4821', event: 'order.paid' },
  },
};

describe('job-service public job routes (the real app over HTTP)', () => {
  let dependencies: ContainerDependencies;
  let service: InProcessJobService;
  let fixtures: ContainerJobFixtures;
  let env: Record<string, string>;

  const url = (path = ''): string => service.url({ path: `${JOBS_ROUTE}${path}` }).url;

  const submit = (body: unknown, target = service): Promise<Response> =>
    fetch(target.url({ path: JOBS_ROUTE }).url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const submitted = async (body: unknown = EMAIL_JOB): Promise<Job> =>
    Job.parse(await (await submit(body)).json());

  const issuePaths = async (response: Response): Promise<unknown[]> => {
    const body = ErrorBody.parse(await response.json());
    expect(body.code).toBe('VALIDATION_FAILED');
    const issues = body.details.issues as { path: unknown[] }[];
    return issues.map((issue) => issue.path);
  };

  beforeAll(async () => {
    ({ dependencies } = await ContainerDependencies.start());
    env = {
      ...JOB_SERVICE_TEST_ENV,
      DATABASE_URL: dependencies.databaseUrl,
      REDIS_URL: dependencies.redisUrl,
      JOB_SERVICE_QUERY_DEFAULT_LIMIT: String(QUERY_DEFAULT_LIMIT),
      JOB_SERVICE_QUERY_MAX_LIMIT: String(QUERY_MAX_LIMIT),
      JOB_SERVICE_ENQUEUE_TIMEOUT_MS: '300',
    };
    ({ service } = await InProcessJobService.start({ env }));
    fixtures = new ContainerJobFixtures({
      databaseUrl: dependencies.databaseUrl,
      redisUrl: dependencies.redisUrl,
    });
  }, 180_000);
  beforeEach(async () => {
    await fixtures.clear();
  });
  afterAll(async () => {
    await fixtures.close();
    await service.close();
    await dependencies.stop();
  });

  describe('submit', () => {
    it('Valid email job is accepted', async () => {
      const response = await submit(EMAIL_JOB);

      expect(response.status).toBe(201);
      const job = Job.parse(await response.json());
      expect(job).toMatchObject({
        type: 'email',
        status: 'pending',
        attempts: 0,
        payload: EMAIL_JOB.payload,
        priority: 7,
        maxAttempts: 4,
        result: null,
        error: null,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
      });
      expect(job.createdAt).toEqual(expect.any(String));
    });

    it('Defaults are applied', async () => {
      const job = await submitted({ type: 'email', payload: EMAIL_JOB.payload });

      expect(job.priority).toBe(JOB_LIMITS.priority.default);
      expect(job.maxAttempts).toBe(JOB_LIMITS.maxAttempts.default);
    });

    it('Submitted job can be read back', async () => {
      const job = await submitted();

      const response = await fetch(url(`/${job.id}`));

      expect(Job.parse(await response.json())).toEqual(job);
    });

    it('Unknown job type', async () => {
      const response = await submit({ ...EMAIL_JOB, type: 'fax' });

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['type']);
      const page = QueryJobsResponse.parse(await (await fetch(url())).json());
      expect(page.total).toBe(0);
    });

    it('Invalid email address', async () => {
      const response = await submit({
        ...EMAIL_JOB,
        payload: { ...EMAIL_JOB.payload, to: 'not-an-email' },
      });

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['payload', 'to']);
    });

    it('Empty subject', async () => {
      const response = await submit({
        ...EMAIL_JOB,
        payload: { ...EMAIL_JOB.payload, subject: '' },
      });

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['payload', 'subject']);
    });

    it('Email field too long', async () => {
      const response = await submit({
        ...EMAIL_JOB,
        payload: { ...EMAIL_JOB.payload, body: 'a'.repeat(EMAIL_LIMITS.bodyMaxLength + 1) },
      });

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['payload', 'body']);
    });

    it('Priority out of range', async () => {
      const response = await submit({ ...EMAIL_JOB, priority: JOB_LIMITS.priority.max + 1 });

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['priority']);
    });

    it('Max attempts out of range', async () => {
      const response = await submit({ ...EMAIL_JOB, maxAttempts: JOB_LIMITS.maxAttempts.min - 1 });

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['maxAttempts']);
    });

    it('Submitted job is queued', async () => {
      const job = await submitted();

      expect((await fixtures.queued({ jobId: job.id })).attempts).toEqual([1]);
    });

    it('Queue unavailable during submit', async () => {
      const { service: withoutQueue } = await InProcessJobService.start({
        env: { ...env, REDIS_URL: UNREACHABLE_REDIS_URL },
      });
      try {
        const response = await submit(EMAIL_JOB, withoutQueue);

        expect(response.status).toBe(201);
        const job = Job.parse(await response.json());
        expect(job.status).toBe('pending');
        const later = Job.parse(await (await fetch(url(`/${job.id}`))).json());
        expect(later.status).toBe('pending');
      } finally {
        await withoutQueue.close();
      }
    });
  });

  describe('get', () => {
    it('Existing job', async () => {
      const { job } = await fixtures.seed({ status: 'completed' });

      const response = await fetch(url(`/${job.id}`));

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toEqual(job);
    });

    it('Unknown job', async () => {
      const response = await fetch(url(`/${UNKNOWN_ID}`));

      expect(response.status).toBe(404);
      expect(ErrorBody.parse(await response.json()).code).toBe('JOB_NOT_FOUND');
    });

    it('Malformed id', async () => {
      const response = await fetch(url('/abc'));

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['id']);
    });
  });

  describe('submit a webhook job', () => {
    const rejected = async (payload: Record<string, unknown>, field: string): Promise<void> => {
      const response = await submit({
        ...WEBHOOK_JOB,
        payload: { ...WEBHOOK_JOB.payload, ...payload },
      });

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['payload', field]);
      const page = QueryJobsResponse.parse(await (await fetch(url())).json());
      expect(page.total).toBe(0);
    };

    it('Valid webhook job is accepted', async () => {
      const response = await submit(WEBHOOK_JOB);

      expect(response.status).toBe(201);
      expect(Job.parse(await response.json())).toMatchObject({
        type: 'webhook',
        status: 'pending',
        attempts: 0,
        payload: WEBHOOK_JOB.payload,
        result: null,
        error: null,
      });
    });

    it('Webhook job without a body is accepted', async () => {
      const payload = { method: 'GET', url: 'http://example.com/ping' };

      const response = await submit({ type: 'webhook', payload });

      expect(response.status).toBe(201);
      expect(Job.parse(await response.json()).payload).toEqual(payload);
    });

    it('Webhook job is read and listed like any job', async () => {
      const email = await submitted(EMAIL_JOB);
      const webhook = await submitted(WEBHOOK_JOB);

      const read = Job.parse(await (await fetch(url(`/${webhook.id}`))).json());
      const page = QueryJobsResponse.parse(await (await fetch(url())).json());

      expect(read).toEqual(webhook);
      expect(page.items).toEqual([webhook, email]);
    });

    it('Method not allowed', async () => {
      await rejected({ method: 'DELETE' }, 'method');
      await rejected({ method: 'post' }, 'method');
    });

    it('URL with another scheme', async () => {
      await rejected({ url: 'ftp://example.com/hook' }, 'url');
    });

    it('Body is not a JSON object', async () => {
      await rejected({ body: ['a'] }, 'body');
    });
  });

  describe('query', () => {
    const query = async (search = ''): Promise<QueryJobsResponse> => {
      const response = await fetch(url(search));
      expect(response.status).toBe(200);
      return QueryJobsResponse.parse(await response.json());
    };

    it('Newest first', async () => {
      const jobs = [await submitted(), await submitted(), await submitted()];

      const page = await query();

      expect(page.items.map((job) => job.id)).toEqual(jobs.map((job) => job.id).reverse());
      expect(page.total).toBe(3);
    });

    it('Paging', async () => {
      const jobs: Job[] = [];
      for (let i = 0; i < 5; i += 1) jobs.push(await submitted());

      const page = await query('?limit=2&offset=1');

      expect(page.items.map((job) => job.id)).toEqual([jobs[3]!.id, jobs[2]!.id]);
      expect(page.total).toBe(5);
    });

    it('Default page size', async () => {
      for (let i = 0; i < QUERY_DEFAULT_LIMIT + 1; i += 1) await submitted();

      expect((await query()).items).toHaveLength(QUERY_DEFAULT_LIMIT);
    });

    it('Empty query result', async () => {
      expect(await query()).toEqual({ items: [], total: 0 });
    });

    it('Limit above maximum', async () => {
      const response = await fetch(url(`?limit=${QUERY_MAX_LIMIT + 1}`));

      expect(response.status).toBe(400);
      expect(ErrorBody.parse(await response.clone().json()).code).toBe('VALIDATION_FAILED');
      expect(await issuePaths(response)).toContainEqual(['limit']);
    });

    it('Negative offset', async () => {
      const response = await fetch(url('?offset=-1'));

      expect(response.status).toBe(400);
      expect(await issuePaths(response)).toContainEqual(['offset']);
    });
  });

  describe('delete', () => {
    it('Delete a finished job', async () => {
      for (const status of ['completed', 'failed', 'cancelled'] as const) {
        const { job } = await fixtures.seed({ status });

        const response = await fetch(url(`/${job.id}`), { method: 'DELETE' });

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect((await fetch(url(`/${job.id}`))).status).toBe(404);
      }
    });

    it('Delete a job that has not finished', async () => {
      for (const status of ['pending', 'processing'] as const) {
        const { job } = await fixtures.seed({ status });

        const response = await fetch(url(`/${job.id}`), { method: 'DELETE' });

        expect(response.status).toBe(409);
        const body = ErrorBody.parse(await response.json());
        expect(body.code).toBe('JOB_STATUS_CONFLICT');
        expect(body.details).toMatchObject({ status });
        expect(Job.parse(await (await fetch(url(`/${job.id}`))).json())).toEqual(job);
      }
    });

    it('Delete an unknown job', async () => {
      const response = await fetch(url(`/${UNKNOWN_ID}`), { method: 'DELETE' });

      expect(response.status).toBe(404);
      expect(ErrorBody.parse(await response.json()).code).toBe('JOB_NOT_FOUND');
    });
  });
});
