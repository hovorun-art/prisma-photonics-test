import { randomUUID } from 'node:crypto';

import {
  EMAIL_LIMITS,
  JOB_LIMITS,
  JOBS_ROUTE,
  Job,
  QueryJobsResponse,
  WEBHOOK_LIMITS,
} from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { JobQueueUnavailableError } from '../../src/domain/jobs/errors/job-queue-unavailable.error.js';
import { JobServiceUnderTest, TEST_CONFIG } from './job-service-under-test.js';

const UNKNOWN_ID = randomUUID();
const ERROR = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };

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

describe('job-service public job routes', () => {
  let service: JobServiceUnderTest;

  /** A submission rejected for `path`, after which nothing is stored or queued. */
  const expectRejected = async (body: unknown, path: unknown[]): Promise<void> => {
    expect(await service.issuePaths(await service.submit(body))).toContainEqual(path);
    expect(await service.total()).toBe(0);
    expect(service.queue.enqueue).not.toHaveBeenCalled();
  };

  const expectNotFound = async (response: Response): Promise<void> => {
    await service.errorBody({ response, status: 404, code: 'JOB_NOT_FOUND' });
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

  describe('submit', () => {
    it('Valid email job is accepted', async () => {
      const response = await service.submit(EMAIL_JOB);

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
      const job = await service.submitted({ type: 'email', payload: EMAIL_JOB.payload });

      expect(job.priority).toBe(JOB_LIMITS.priority.default);
      expect(job.maxAttempts).toBe(JOB_LIMITS.maxAttempts.default);
    });

    it('Submitted job can be read back', async () => {
      const job = await service.submitted(EMAIL_JOB);

      expect(Job.parse(await (await service.get(job.id)).json())).toEqual(job);
    });

    it.each([EMAIL_JOB, WEBHOOK_JOB])('Submitted job is queued ($type)', async (body) => {
      const job = await service.submitted(body);

      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, attempt: 1 });
    });

    it('Queue unavailable during submit', async () => {
      service.queue.enqueue.mockImplementationOnce(({ jobId, attempt }) =>
        Promise.reject(new JobQueueUnavailableError({ jobId, attempt })),
      );

      const response = await service.submit(EMAIL_JOB);

      expect(response.status).toBe(201);
      const job = Job.parse(await response.json());
      expect(job.status).toBe('pending');
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, attempt: 1 });
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Concurrent submissions are separate jobs', async () => {
      const jobs = await Promise.all([
        service.submitted(EMAIL_JOB),
        service.submitted(EMAIL_JOB),
        service.submitted(EMAIL_JOB),
      ]);

      expect(new Set(jobs.map((job) => job.id)).size).toBe(3);
      expect(service.queue.enqueue).toHaveBeenCalledTimes(3);
      for (const job of jobs) {
        expect(service.queue.enqueue).toHaveBeenCalledWith({ jobId: job.id, attempt: 1 });
      }
      expect(await service.total()).toBe(3);
    });

    it('Unknown job type', async () => {
      await expectRejected({ ...EMAIL_JOB, type: 'fax' }, ['type']);
    });

    it('Priority out of range', async () => {
      await expectRejected({ ...EMAIL_JOB, priority: JOB_LIMITS.priority.max + 1 }, ['priority']);
    });

    it('Max attempts out of range', async () => {
      await expectRejected({ ...EMAIL_JOB, maxAttempts: JOB_LIMITS.maxAttempts.min - 1 }, [
        'maxAttempts',
      ]);
    });

    it('Fields the server owns are ignored on submit', async () => {
      const job = await service.submitted({
        ...EMAIL_JOB,
        id: UNKNOWN_ID,
        status: 'completed',
        attempts: 5,
        result: { messageId: 'forged' },
        error: ERROR,
        startedAt: new Date().toISOString(),
      });

      expect(job.id).not.toBe(UNKNOWN_ID);
      expect(job).toMatchObject({
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        startedAt: null,
      });
      expect(service.queue.enqueue).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, attempt: 1 });
    });
  });

  describe('submit an email job', () => {
    const withPayload = (payload: Record<string, unknown>): unknown => ({
      ...EMAIL_JOB,
      payload: { ...EMAIL_JOB.payload, ...payload },
    });

    it('Invalid email address', async () => {
      await expectRejected(withPayload({ to: 'not-an-email' }), ['payload', 'to']);
    });

    it('Empty subject', async () => {
      await expectRejected(withPayload({ subject: '' }), ['payload', 'subject']);
    });

    it('Email field too long', async () => {
      await expectRejected(withPayload({ body: 'a'.repeat(EMAIL_LIMITS.bodyMaxLength + 1) }), [
        'payload',
        'body',
      ]);
    });
  });

  describe('submit a webhook job', () => {
    const withPayload = (payload: Record<string, unknown>): unknown => ({
      ...WEBHOOK_JOB,
      payload: { ...WEBHOOK_JOB.payload, ...payload },
    });

    const urlOfLength = (length: number): string => {
      const prefix = 'https://hooks.example.com/';
      return prefix + 'a'.repeat(length - prefix.length);
    };

    it('Valid webhook job is accepted', async () => {
      const response = await service.submit(WEBHOOK_JOB);

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

      const job = await service.submitted({ type: 'webhook', payload });

      expect(job.payload).toEqual(payload);
    });

    it('Webhook job is read and listed like any job', async () => {
      const email = await service.submitted(EMAIL_JOB);
      const webhook = await service.submitted(WEBHOOK_JOB);

      const read = Job.parse(await (await service.get(webhook.id)).json());
      const page = QueryJobsResponse.parse(await (await fetch(service.url(JOBS_ROUTE))).json());

      expect(read).toEqual(webhook);
      expect(page.items).toEqual([webhook, email]);
    });

    it('Method not allowed', async () => {
      await expectRejected(withPayload({ method: 'DELETE' }), ['payload', 'method']);
    });

    it('URL with another scheme', async () => {
      await expectRejected(withPayload({ url: 'ftp://example.com/hook' }), ['payload', 'url']);
    });

    it('URL missing or not a URL', async () => {
      await expectRejected(withPayload({ url: 'not a url' }), ['payload', 'url']);
    });

    it('URL too long', async () => {
      await expectRejected(withPayload({ url: urlOfLength(WEBHOOK_LIMITS.urlMaxLength + 1) }), [
        'payload',
        'url',
      ]);
    });

    it('Body is not a JSON object', async () => {
      await expectRejected(withPayload({ body: ['a'] }), ['payload', 'body']);
    });
  });

  describe('get', () => {
    it('Existing job', async () => {
      const job = await service.seed({ status: 'completed' });

      const response = await service.get(job.id);

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toEqual(job);
    });

    it('Unknown job', async () => {
      await expectNotFound(await service.get(UNKNOWN_ID));
    });

    it('Malformed id', async () => {
      expect(await service.issuePaths(await service.get('abc'))).toContainEqual(['id']);
    });
  });

  describe('query', () => {
    const query = async (search = ''): Promise<QueryJobsResponse> => {
      const response = await fetch(service.url(`${JOBS_ROUTE}${search}`));
      expect(response.status).toBe(200);
      return QueryJobsResponse.parse(await response.json());
    };

    const submittedInOrder = async (count: number): Promise<Job[]> => {
      const jobs: Job[] = [];
      for (let i = 0; i < count; i += 1) jobs.push(await service.submitted(EMAIL_JOB));
      return jobs;
    };

    it('Newest first', async () => {
      const jobs = await submittedInOrder(3);

      const page = await query();

      expect(page.items.map((job) => job.id)).toEqual(jobs.map((job) => job.id).reverse());
      expect(page.total).toBe(3);
    });

    it('Paging', async () => {
      const jobs = await submittedInOrder(5);

      const page = await query('?limit=2&offset=1');
      const last = await query('?limit=2&offset=4');
      const past = await query('?limit=2&offset=5');

      expect(page.items.map((job) => job.id)).toEqual([jobs[3]!.id, jobs[2]!.id]);
      expect(page.total).toBe(5);
      expect(last.items.map((job) => job.id)).toEqual([jobs[0]!.id]);
      expect(past).toEqual({ items: [], total: 5 });
    });

    it('Default page size', async () => {
      const jobs = await submittedInOrder(TEST_CONFIG.queryDefaultLimit + 1);

      const page = await query();

      expect(page.items.map((job) => job.id)).toEqual(
        jobs
          .slice(1)
          .map((job) => job.id)
          .reverse(),
      );
      expect(page.total).toBe(TEST_CONFIG.queryDefaultLimit + 1);
    });

    it('Maximum page size is accepted', async () => {
      await submittedInOrder(TEST_CONFIG.queryMaxLimit + 1);

      expect((await query(`?limit=${TEST_CONFIG.queryMaxLimit}`)).items).toHaveLength(
        TEST_CONFIG.queryMaxLimit,
      );
    });

    it('Empty query result', async () => {
      expect(await query()).toEqual({ items: [], total: 0 });
    });

    it('Limit above maximum', async () => {
      const response = await fetch(
        service.url(`${JOBS_ROUTE}?limit=${TEST_CONFIG.queryMaxLimit + 1}`),
      );

      expect(await service.issuePaths(response)).toContainEqual(['limit']);
    });

    it('Negative offset', async () => {
      const response = await fetch(service.url(`${JOBS_ROUTE}?offset=-1`));

      expect(await service.issuePaths(response)).toContainEqual(['offset']);
    });
  });

  describe('delete', () => {
    it('Delete a finished job', async () => {
      const status = 'completed';
      const job = await service.seed({ status });

      const response = await service.remove(job.id);

      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      await expectNotFound(await service.get(job.id));
      await expectNotFound(await service.remove(job.id));
    });

    it('Delete a finished webhook job', async () => {
      const job = await service.seed({ status: 'completed', type: 'webhook' });

      expect((await service.remove(job.id)).status).toBe(204);
      await expectNotFound(await service.get(job.id));
    });

    it('Delete a job that has not finished', async () => {
      const status = 'pending';
      const job = await service.seed({ status });

      await service.expectConflict({ response: await service.remove(job.id), status });
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Two clients delete the same job', async () => {
      const job = await service.seed({ status: 'completed' });

      const responses = await Promise.all([service.remove(job.id), service.remove(job.id)]);

      expect(responses.map((response) => response.status).sort()).toEqual([204, 404]);
      await expectNotFound(responses.find((response) => response.status === 404)!);
    });

    it('Delete an unknown job', async () => {
      await expectNotFound(await service.remove(UNKNOWN_ID));
    });

    it('Delete with a malformed id', async () => {
      expect(await service.issuePaths(await service.remove('abc'))).toContainEqual(['id']);
    });
  });
});
