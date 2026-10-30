import { randomUUID } from 'node:crypto';

import { INTERNAL_API_PREFIX, JOBS_ROUTE, Job, SERVICE_TOKEN_SCHEME } from '@job-queue/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { JOB_REPOSITORY, type JobRepository } from '../../src/domain/jobs/job-repository.js';
import { AUTHORIZATION, JobServiceUnderTest, TEST_CONFIG } from './job-service-under-test.js';

const UNKNOWN_ID = randomUUID();
const INTERNAL_SECRET = 'connection pool exhausted: secret internals';
const EMAIL_JOB = {
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
};
const WEBHOOK_JOB = {
  type: 'webhook',
  payload: { method: 'POST', url: 'https://hooks.example.com/orders' },
};

describe('job-service error responses and internal access', () => {
  let service: JobServiceUnderTest;

  beforeAll(async () => {
    service = await JobServiceUnderTest.start();
  }, 180_000);
  beforeEach(async () => {
    await service.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await service.close();
  });

  describe('error responses', () => {
    it('Known failure', async () => {
      const body = await service.errorBody({
        response: await service.read({ id: UNKNOWN_ID, authorization: null }),
        status: 401,
        code: 'INTERNAL_UNAUTHORIZED',
      });

      expect(body.details).toEqual(expect.any(Object));
    });

    it('Unexpected failure', async () => {
      const job = await service.seed({ status: 'pending' });
      vi.spyOn(service.app.get<JobRepository>(JOB_REPOSITORY), 'get').mockRejectedValueOnce(
        new Error(INTERNAL_SECRET),
      );

      const response = await service.get(job.id);

      const text = await response.clone().text();
      const body = await service.errorBody({ response, status: 500, code: 'INTERNAL_ERROR' });
      expect(body.details).toEqual({});
      expect(text).not.toContain('secret internals');
    });

    it.each([
      ['GET', '/no-such-route'],
      ['PUT', JOBS_ROUTE],
      ['GET', `${INTERNAL_API_PREFIX}/no-such-route`],
    ])('Unknown route (%s %s)', async (method, path) => {
      const response = await fetch(service.url(path), {
        method,
        headers: { authorization: AUTHORIZATION },
      });

      const body = await service.errorBody({ response, status: 404, code: 'ROUTE_NOT_FOUND' });
      expect(body.details).toEqual(expect.any(Object));
    });

    it('Invalid request', async () => {
      const response = await service.submit({ ...EMAIL_JOB, priority: 'high', maxAttempts: 0 });

      const paths = await service.issuePaths(response);
      expect(paths).toContainEqual(['priority']);
      expect(paths).toContainEqual(['maxAttempts']);
    });

    it('Malformed body', async () => {
      const body = await service.errorBody({
        response: await service.submit('{"type": '),
        status: 400,
        code: 'VALIDATION_FAILED',
      });

      expect(body.details).toEqual(expect.any(Object));
      expect(await service.total()).toBe(0);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it.each([['[]'], ['42']])('Body is JSON but not an object (%s)', async (raw) => {
      await service.errorBody({
        response: await service.submit(raw),
        status: 400,
        code: 'VALIDATION_FAILED',
      });
      expect(await service.total()).toBe(0);
      expect(service.queue.enqueue).not.toHaveBeenCalled();
    });

    it('Body is not JSON', async () => {
      const response = await fetch(service.url(JOBS_ROUTE), {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(EMAIL_JOB),
      });

      await service.errorBody({ response, status: 400, code: 'VALIDATION_FAILED' });
      expect(await service.total()).toBe(0);
    });

    it('Body too large', async () => {
      const response = await service.submit({
        ...EMAIL_JOB,
        payload: { ...EMAIL_JOB.payload, body: 'a'.repeat(TEST_CONFIG.bodyLimitBytes * 2) },
      });

      const body = await service.errorBody({ response, status: 413, code: 'PAYLOAD_TOO_LARGE' });
      expect(body.details).toEqual({ limitBytes: TEST_CONFIG.bodyLimitBytes });
      expect(await service.total()).toBe(0);
    });

    const post = (encoding: string): Promise<Response> =>
      fetch(service.url(JOBS_ROUTE), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': encoding },
        body: JSON.stringify(EMAIL_JOB),
      });

    it('Body in an unsupported content encoding', async () => {
      const body = await service.errorBody({
        response: await post('xyz'),
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });

      expect(body.details).toEqual({});
      expect(await service.total()).toBe(0);
    });

    it('Body that is not in its declared content encoding', async () => {
      await service.errorBody({
        response: await post('br'),
        status: 400,
        code: 'VALIDATION_FAILED',
      });

      expect(await service.total()).toBe(0);
    });

    it('Body at the size limit is accepted', async () => {
      const sized = (padding: string): string =>
        JSON.stringify({ ...WEBHOOK_JOB, payload: { ...WEBHOOK_JOB.payload, body: { padding } } });
      const room = TEST_CONFIG.bodyLimitBytes - sized('').length;
      const atLimit = sized('a'.repeat(room));
      expect(Buffer.byteLength(atLimit)).toBe(TEST_CONFIG.bodyLimitBytes);

      expect((await service.submit(atLimit)).status).toBe(201);
      await service.errorBody({
        response: await service.submit(sized('a'.repeat(room + 1))),
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
      });
    });
  });

  describe('bulk size range', () => {
    /** A bulk of one webhook job padded so the whole body is exactly `bytes` long. */
    const bulkOfSize = (bytes: number): string => {
      const sized = (padding: string): string =>
        JSON.stringify({
          jobs: [{ ...WEBHOOK_JOB, payload: { ...WEBHOOK_JOB.payload, body: { padding } } }],
        });
      const body = sized('a'.repeat(bytes - sized('').length));
      expect(Buffer.byteLength(body)).toBe(bytes);
      return body;
    };

    it('Empty bulk', async () => {
      const paths = await service.issuePaths(await service.submitBulk({ jobs: [] }));

      expect(paths).toEqual([['jobs']]);
      expect(await service.total()).toBe(0);
    });

    it('Too many jobs', async () => {
      const jobs = Array.from({ length: TEST_CONFIG.bulkMaxJobs + 1 }, () => EMAIL_JOB);

      const body = await service.errorBody({
        response: await service.submitBulk({ jobs }),
        status: 400,
        code: 'VALIDATION_FAILED',
      });

      expect(body.details).toEqual({
        issues: [expect.objectContaining({ path: ['jobs'], maximum: TEST_CONFIG.bulkMaxJobs })],
      });
      expect(await service.total()).toBe(0);
      expect(service.queue.enqueueMany).not.toHaveBeenCalled();
    });

    it('Largest allowed bulk', async () => {
      const jobs = Array.from({ length: TEST_CONFIG.bulkMaxJobs }, () => EMAIL_JOB);

      expect((await service.submittedBulk(jobs)).length).toBe(TEST_CONFIG.bulkMaxJobs);
      expect(await service.total()).toBe(TEST_CONFIG.bulkMaxJobs);
    });

    it('Bulk body above the body size limit', async () => {
      const response = await service.submitBulk(bulkOfSize(TEST_CONFIG.bodyLimitBytes + 1));

      const body = await service.errorBody({ response, status: 413, code: 'PAYLOAD_TOO_LARGE' });
      expect(body.details).toEqual({ limitBytes: TEST_CONFIG.bodyLimitBytes });
      expect(await service.total()).toBe(0);
    });

    it('Bulk body at the body size limit', async () => {
      const response = await service.submitBulk(bulkOfSize(TEST_CONFIG.bodyLimitBytes));

      expect(response.status).toBe(201);
      expect(await service.total()).toBe(1);
    });
  });

  describe('internal access', () => {
    const expectUnauthorized = async (response: Response): Promise<void> => {
      await service.errorBody({ response, status: 401, code: 'INTERNAL_UNAUTHORIZED' });
    };

    it('Missing token', async () => {
      const job = await service.seed({ status: 'pending' });

      await expectUnauthorized(await service.read({ id: job.id, authorization: null }));
      await expectUnauthorized(
        await service.report({ id: job.id, body: { status: 'processing' }, authorization: null }),
      );
      expect(await service.stored(job.id)).toEqual(job);
    });

    it('Wrong token', async () => {
      const authorization = `${SERVICE_TOKEN_SCHEME} not-the-configured-token`;
      const job = await service.seed({ status: 'pending' });

      await expectUnauthorized(await service.read({ id: job.id, authorization }));
      await expectUnauthorized(
        await service.report({ id: job.id, body: { status: 'processing' }, authorization }),
      );
      expect(await service.stored(job.id)).toEqual(job);
    });

    it.each([
      ['an unknown job', () => service.read({ id: UNKNOWN_ID, authorization: null })],
      [
        'an unknown internal route',
        () => fetch(service.url(`${INTERNAL_API_PREFIX}/no-such-route`)),
      ],
      [
        'a malformed report',
        () => service.report({ id: UNKNOWN_ID, body: '{"status": ', authorization: null }),
      ],
      [
        'an oversized report',
        () =>
          service.report({
            id: UNKNOWN_ID,
            body: 'a'.repeat(TEST_CONFIG.bodyLimitBytes * 2),
            authorization: null,
          }),
      ],
    ])('Missing token is checked first (%s)', async (_case, call) => {
      await expectUnauthorized(await call());
    });

    it('Valid token', async () => {
      const job = await service.seed({ status: 'pending' });

      const response = await service.read({ id: job.id });

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toEqual(job);
    });
  });
});
