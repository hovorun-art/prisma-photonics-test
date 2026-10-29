import { ErrorBody, INTERNAL_JOBS_ROUTE, Job, SERVICE_TOKEN_SCHEME } from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ContainerDependencies } from './support/container-dependencies.js';
import { UNREACHABLE_REDIS_URL } from './support/dependencies.js';
import { InProcessJobService } from './support/in-process-job-service.js';
import { ContainerJobFixtures } from './support/job-fixtures.js';
import { JOB_SERVICE_TEST_ENV } from './support/running-job-service.js';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const AUTHORIZATION = `${SERVICE_TOKEN_SCHEME} ${JOB_SERVICE_TEST_ENV.INTERNAL_SERVICE_TOKEN}`;
const ERROR = { code: 'SEND_FAILED', message: 'Mailbox unavailable' };

describe('job-service internal job routes (the real app over HTTP)', () => {
  let dependencies: ContainerDependencies;
  let service: InProcessJobService;
  let fixtures: ContainerJobFixtures;
  let env: Record<string, string>;

  const read = (id: string): Promise<Response> =>
    fetch(service.url({ path: `${INTERNAL_JOBS_ROUTE}/${id}` }).url, {
      headers: { authorization: AUTHORIZATION },
    });

  const report = (id: string, body: unknown, target = service): Promise<Response> =>
    fetch(target.url({ path: `${INTERNAL_JOBS_ROUTE}/${id}` }).url, {
      method: 'PATCH',
      headers: { authorization: AUTHORIZATION, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const stored = async (id: string): Promise<Job> => Job.parse(await (await read(id)).json());

  const expectConflict = async (response: Response, status: string): Promise<void> => {
    expect(response.status).toBe(409);
    const body = ErrorBody.parse(await response.json());
    expect(body.code).toBe('JOB_STATUS_CONFLICT');
    expect(body.details).toMatchObject({ status });
  };

  beforeAll(async () => {
    ({ dependencies } = await ContainerDependencies.start());
    env = {
      ...JOB_SERVICE_TEST_ENV,
      DATABASE_URL: dependencies.databaseUrl,
      REDIS_URL: dependencies.redisUrl,
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

  describe('read', () => {
    it('Read an existing job', async () => {
      const { job } = await fixtures.seed({ status: 'pending' });

      const response = await read(job.id);

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toEqual(job);
    });

    it('Read an unknown job', async () => {
      const response = await read(UNKNOWN_ID);

      expect(response.status).toBe(404);
      expect(ErrorBody.parse(await response.json()).code).toBe('JOB_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('Unknown target status', async () => {
      const { job } = await fixtures.seed({ status: 'pending' });

      const response = await report(job.id, { status: 'cancelled' });

      expect(response.status).toBe(400);
      expect(ErrorBody.parse(await response.json()).code).toBe('VALIDATION_FAILED');
      expect(await stored(job.id)).toEqual(job);
    });

    it('Result does not match the job type', async () => {
      const { job } = await fixtures.seed({ status: 'processing' });

      const response = await report(job.id, { status: 'completed', result: { id: 'm-1' } });

      expect(response.status).toBe(400);
      expect(ErrorBody.parse(await response.json()).code).toBe('VALIDATION_FAILED');
      expect(await stored(job.id)).toEqual(job);
    });

    it('Report for an unknown job', async () => {
      const response = await report(UNKNOWN_ID, { status: 'processing' });

      expect(response.status).toBe(404);
      expect(ErrorBody.parse(await response.json()).code).toBe('JOB_NOT_FOUND');
    });

    it('Start a pending job', async () => {
      const { job } = await fixtures.seed({ status: 'pending', attempts: 0 });

      const response = await report(job.id, { status: 'processing' });

      expect(response.status).toBe(200);
      const started = Job.parse(await response.json());
      expect(started).toMatchObject({ status: 'processing', attempts: 1 });
      expect(started.startedAt).toEqual(expect.any(String));
    });

    it('Start a job that is not pending', async () => {
      for (const status of ['processing', 'completed', 'failed'] as const) {
        const { job } = await fixtures.seed({ status });

        await expectConflict(await report(job.id, { status: 'processing' }), status);
        expect(await stored(job.id)).toEqual(job);
      }
    });

    it('Two workers start the same job', async () => {
      const { job } = await fixtures.seed({ status: 'pending', attempts: 0 });

      const responses = await Promise.all([
        report(job.id, { status: 'processing' }),
        report(job.id, { status: 'processing' }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const loser = responses.find((response) => response.status === 409)!;
      expect(ErrorBody.parse(await loser.json()).code).toBe('JOB_STATUS_CONFLICT');
      expect((await stored(job.id)).attempts).toBe(1);
    });

    it('Complete a processing job', async () => {
      const { job } = await fixtures.seed({ status: 'processing' });

      const response = await report(job.id, {
        status: 'completed',
        result: { messageId: 'm-1' },
      });

      expect(response.status).toBe(200);
      const completed = Job.parse(await response.json());
      expect(completed).toMatchObject({ status: 'completed', result: { messageId: 'm-1' } });
      expect(completed.completedAt).toEqual(expect.any(String));
    });

    it('Complete a job that is not processing', async () => {
      for (const status of ['pending', 'completed', 'failed'] as const) {
        const { job } = await fixtures.seed({ status });

        await expectConflict(
          await report(job.id, { status: 'completed', result: { messageId: 'm-1' } }),
          status,
        );
        expect(await stored(job.id)).toEqual(job);
      }
    });

    it('Failure with attempts left', async () => {
      const { job } = await fixtures.seed({ status: 'processing', attempts: 1, maxAttempts: 3 });

      const response = await report(job.id, { status: 'failed', error: ERROR });

      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toMatchObject({
        status: 'pending',
        error: ERROR,
        completedAt: null,
      });
      expect((await fixtures.queued({ jobId: job.id })).attempts).toEqual([2]);
    });

    it('Retry survives an unavailable queue', async () => {
      const { job } = await fixtures.seed({ status: 'processing', attempts: 1, maxAttempts: 3 });
      const { service: withoutQueue } = await InProcessJobService.start({
        env: { ...env, REDIS_URL: UNREACHABLE_REDIS_URL },
      });
      try {
        const response = await report(job.id, { status: 'failed', error: ERROR }, withoutQueue);

        expect(response.status).toBe(200);
        expect(Job.parse(await response.json())).toMatchObject({ status: 'pending', error: ERROR });
      } finally {
        await withoutQueue.close();
      }
    });

    it('Fail a job that is not processing', async () => {
      for (const status of ['pending', 'completed', 'failed'] as const) {
        const { job } = await fixtures.seed({ status });

        await expectConflict(await report(job.id, { status: 'failed', error: ERROR }), status);
        expect(await stored(job.id)).toEqual(job);
      }
    });

    it('Failure on the last attempt', async () => {
      const { job } = await fixtures.seed({ status: 'processing', attempts: 3, maxAttempts: 3 });

      const response = await report(job.id, { status: 'failed', error: ERROR });

      expect(response.status).toBe(200);
      const failed = Job.parse(await response.json());
      expect(failed).toMatchObject({ status: 'failed', error: ERROR });
      expect(failed.completedAt).toEqual(expect.any(String));
      expect((await fixtures.queued({ jobId: job.id })).attempts).toEqual([]);
    });
  });
});
