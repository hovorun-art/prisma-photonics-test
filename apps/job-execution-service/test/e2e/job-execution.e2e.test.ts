import { randomUUID } from 'node:crypto';

import { fileURLToPath } from 'node:url';

import { JOB_QUEUE_NAME, type Job, JobQueueEntryId } from '@job-queue/contracts';
import {
  CONTAINER_IMAGES,
  NodeServiceLauncher,
  NpmServiceBuild,
  type SpawnedService,
} from '@job-queue/test-support';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HttpSimulatedJobService } from './support/simulated-job-service.js';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * job-execution-service as a black box: the compiled process with its own Redis (Testcontainers)
 * and a simulated job-service that serves jobs and records the state reports.
 */

const TOKEN = 'e2e-service-token';
const POLL = { timeout: 15_000, interval: 50 };
const JOB_ID = randomUUID();

describe('job-execution-service running jobs', () => {
  let redis: StartedRedisContainer;
  let producer: Queue;
  let jobService: HttpSimulatedJobService;
  let instance: SpawnedService | undefined;
  const launcher = new NodeServiceLauncher({
    appRoot,
    portVariable: 'JOB_EXECUTION_SERVICE_PORT',
    serviceName: 'job-execution-service',
  });

  const pendingJob = (overrides: Record<string, unknown> = {}): Job => ({
    id: JOB_ID,
    type: 'email',
    payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi' },
    status: 'pending',
    priority: 5,
    attempts: 0,
    maxAttempts: 3,
    result: null,
    error: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-29T11:00:00.000Z',
    updatedAt: '2026-10-29T11:00:00.000Z',
    ...overrides,
  });

  /** Starts an instance against the simulated job-service; `env` overrides the defaults. */
  const startInstance = async (env: Record<string, string> = {}): Promise<SpawnedService> => {
    const { service } = await launcher.start({
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        REDIS_URL: redis.getConnectionUrl(),
        JOB_SERVICE_URL: jobService.url,
        INTERNAL_SERVICE_TOKEN: TOKEN,
        EMAIL_SEND_MIN_MS: '50',
        EMAIL_SEND_MAX_MS: '100',
        JOB_REPORT_RETRY_DELAY_MS: '50',
        ...env,
      },
    });
    instance = service;
    return service;
  };

  /** Queues an entry the way job-service does: data `{ jobId }`, id `<jobId>_<attempt>`. */
  const enqueue = async (jobId = JOB_ID, attempt = 1): Promise<void> => {
    const entryId = JobQueueEntryId.encode({ jobId, attempt });
    await producer.add(entryId, { jobId }, { jobId: entryId });
  };

  const reportedStatuses = (): string[] =>
    jobService.reports({ id: JOB_ID }).reports.map((report) => report.status);

  const logged = (running: SpawnedService, text: string): boolean =>
    running.logs.some((line) => line.msg?.includes(text) === true && line.jobId === JOB_ID);

  beforeAll(async () => {
    [redis] = await Promise.all([
      new RedisContainer(CONTAINER_IMAGES.redis).start(),
      new NpmServiceBuild({ repoRoot, workspace: '@job-queue/job-execution-service' }).build(),
    ]);
    producer = new Queue(JOB_QUEUE_NAME, { connection: { url: redis.getConnectionUrl() } });
  }, 180_000);
  beforeEach(async () => {
    ({ service: jobService } = await HttpSimulatedJobService.start({ serviceToken: TOKEN }));
  });
  afterEach(async () => {
    instance?.kill();
    instance = undefined;
    await jobService.close();
    await producer.obliterate({ force: true });
  });
  afterAll(async () => {
    await producer.close();
    await redis.stop();
  });

  it('Pending job runs to completion', async () => {
    jobService.serve({ id: JOB_ID, job: pendingJob() });
    await startInstance();

    await enqueue();

    await expect.poll(reportedStatuses, POLL).toEqual(['processing', 'completed']);
    const completed = jobService.reports({ id: JOB_ID }).reports[1];
    expect(completed).toEqual({
      status: 'completed',
      result: { messageId: expect.any(String) as string },
    });
  });

  it('Job already taken or finished', async () => {
    jobService.serve({ id: JOB_ID, job: pendingJob({ status: 'completed', attempts: 1 }) });
    const running = await startInstance();

    await enqueue();

    await expect.poll(() => logged(running, 'no longer pending'), POLL).toBe(true);
    expect(reportedStatuses()).toEqual([]);
  });

  it('Job deleted', async () => {
    const running = await startInstance();

    await enqueue();

    await expect.poll(() => logged(running, 'no longer exists'), POLL).toBe(true);
    expect(reportedStatuses()).toEqual([]);
  });

  it('Another worker started the job first', async () => {
    jobService.serve({ id: JOB_ID, job: pendingJob() });
    jobService.refuse({ status: 'processing', httpStatus: 409, times: 1 });
    const running = await startInstance();

    await enqueue();

    await expect.poll(() => logged(running, 'did not let this worker start'), POLL).toBe(true);
    const skip = running.logs.find((line) => line.msg?.includes('did not let this worker start'));
    expect(skip?.level).toBe(30);
    expect(reportedStatuses()).toEqual(['processing']);
  });

  it('Invalid payload', async () => {
    jobService.serve({
      id: JOB_ID,
      job: { ...pendingJob(), payload: { to: 'not-an-email', subject: '', body: 'Hi' } },
    });
    await startInstance();

    await enqueue();

    await expect.poll(reportedStatuses, POLL).toEqual(['processing', 'failed']);
    expect(jobService.reports({ id: JOB_ID }).reports[1]).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_PAYLOAD' },
    });
  });

  it('Report succeeds after a retry', async () => {
    jobService.serve({ id: JOB_ID, job: pendingJob() });
    jobService.refuse({ status: 'completed', httpStatus: 503, times: 1 });
    await startInstance();

    await enqueue();

    await expect.poll(reportedStatuses, POLL).toEqual(['processing', 'completed', 'completed']);
  });

  it('Report keeps failing', async () => {
    jobService.serve({ id: JOB_ID, job: pendingJob() });
    jobService.refuse({ status: 'completed', httpStatus: 503, times: 100 });
    const running = await startInstance({ JOB_REPORT_RETRIES: '2' });

    await enqueue();

    await expect.poll(() => logged(running, 'Gave up reporting'), POLL).toBe(true);
    const gaveUp = running.logs.find((line) => line.msg?.includes('Gave up reporting'));
    expect(gaveUp?.level).toBe(50);
    expect(reportedStatuses()).toEqual(['processing', 'completed', 'completed', 'completed']);
  });

  it('Job running during shutdown', async () => {
    jobService.serve({ id: JOB_ID, job: pendingJob() });
    const running = await startInstance({ EMAIL_SEND_MIN_MS: '1500', EMAIL_SEND_MAX_MS: '1500' });
    await enqueue();
    await expect.poll(reportedStatuses, POLL).toEqual(['processing']);

    const { exitCode } = await running.stop({ signal: 'SIGTERM' });

    expect(exitCode).toBe(0);
    expect(reportedStatuses()).toEqual(['processing', 'completed']);
  });

  it('Grace period runs out', async () => {
    jobService.serve({ id: JOB_ID, job: pendingJob() });
    const running = await startInstance({
      EMAIL_SEND_MIN_MS: '10000',
      EMAIL_SEND_MAX_MS: '10000',
      JOB_EXECUTION_SHUTDOWN_GRACE_MS: '300',
    });
    await enqueue();
    await expect.poll(reportedStatuses, POLL).toEqual(['processing']);
    const stoppedAt = performance.now();

    await running.stop({ signal: 'SIGTERM' });

    expect(performance.now() - stoppedAt).toBeLessThan(5_000);
    expect(reportedStatuses()).toEqual(['processing']);
  });

  it('Logs of a completed job', async () => {
    jobService.serve({ id: JOB_ID, job: pendingJob() });
    const running = await startInstance();

    await enqueue();

    await expect.poll(() => logged(running, 'Job completed'), POLL).toBe(true);
    const jobLines = running.logs.filter((line) => line.jobId === JOB_ID);
    expect(jobLines.length).toBeGreaterThan(1);
    for (const line of jobLines) {
      expect(line).toMatchObject({
        jobId: JOB_ID,
        attempt: 1,
        instanceId: expect.any(String) as string,
      });
    }
  });
});
