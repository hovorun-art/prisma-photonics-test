import { randomUUID } from 'node:crypto';

import {
  EmailJobResult,
  ErrorBody,
  JOB_ERROR_CODES,
  JOBS_ROUTE,
  Job,
  type JobLogEntry,
  QueryJobLogResponse,
  QueryJobsResponse,
  QueueStats,
  STATS_ROUTE,
} from '@job-queue/contracts';
import { type APIRequestContext, expect, test } from '@playwright/test';

import { en } from '../../apps/job-ui/src/locales/en.js';
import { stack } from './support/running-stack.js';
import { StackJobs } from './support/stack-jobs.js';
import { JOB_SERVICE_URL } from './support/stack-settings.js';

test('Submitted email job completes end to end: API, Postgres, queue, execution, Postgres', async ({
  request,
}) => {
  const submitted = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
    data: {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
    },
  });
  expect(submitted.status()).toBe(201);
  const { id } = Job.parse(await submitted.json());

  const read = async (): Promise<Job> =>
    Job.parse(await (await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}`)).json());

  await expect.poll(async () => (await read()).status, { timeout: 30_000 }).toBe('completed');
  const job = await read();
  expect(EmailJobResult.parse(job.result).messageId).toEqual(expect.any(String));
  expect(job.attempts).toBe(1);
});

test('Scheduled job waits, then Scheduled job runs after its time: completes no earlier than it', async ({
  request,
}) => {
  // Far enough ahead to read the job while it waits, close enough for a test.
  const scheduledAt = new Date(Date.now() + 5_000).toISOString();
  const submitted = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
    data: {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Later', body: 'Hi Ada' },
      scheduledAt,
    },
  });
  expect(submitted.status()).toBe(201);
  const { id } = Job.parse(await submitted.json());

  const read = async (): Promise<Job> =>
    Job.parse(await (await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}`)).json());

  // Scheduled job waits: while its time has not come, a free worker leaves it alone.
  const waiting = await read();
  expect(Date.now()).toBeLessThan(Date.parse(scheduledAt));
  expect(waiting).toMatchObject({ status: 'scheduled', attempts: 0, startedAt: null, scheduledAt });

  await expect.poll(async () => (await read()).status, { timeout: 30_000 }).toBe('completed');
  const job = await read();
  expect(job.attempts).toBe(1);
  expect(Date.parse(job.startedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(scheduledAt));
});

test('Queue statistics through the stack: the API answers and the jobs list shows them', async ({
  page,
  request,
}) => {
  const statsResponse = await request.get(`${JOB_SERVICE_URL}${STATS_ROUTE}`);
  expect(statsResponse.status()).toBe(200);
  QueueStats.parse(await statsResponse.json());

  await page.goto('/jobs');
  await expect(page.getByRole('banner').getByText(en.frame.apiOnline)).toBeVisible();
  const completedCard = page.getByRole('group', { name: en.list.stats.completed });
  const completedCount = async (): Promise<number> =>
    Number((await completedCard.locator('[data-stat-value]').innerText()).replaceAll(',', ''));
  await expect(completedCard.locator('[data-stat-value]')).toHaveText(/^[\d,]+$/);
  const before = await completedCount();

  const submitted = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
    data: {
      type: 'email',
      payload: { to: 'ada@example.com', subject: 'Counted', body: 'Hi Ada' },
    },
  });
  expect(submitted.status()).toBe(201);

  // A job-execution-service instance completes it; the cards poll until the count moves.
  await expect.poll(completedCount, { timeout: 30_000 }).toBeGreaterThan(before);
});

test('Filter by type through the stack: under Webhook the jobs list shows only webhook jobs', async ({
  page,
  request,
}) => {
  const submit = async (data: unknown): Promise<Job> => {
    const response = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, { data });
    expect(response.status()).toBe(201);
    return Job.parse(await response.json());
  };
  const email = await submit({
    type: 'email',
    payload: { to: 'ada@example.com', subject: 'Filtered out', body: 'Hi Ada' },
  });
  const webhook = await submit({
    type: 'webhook',
    payload: { method: 'POST', url: 'https://hooks.example.com/orders' },
  });

  await page.goto('/jobs');
  await expect(page.getByRole('link', { name: email.id.slice(0, 8) })).toBeVisible();
  const typeFilter = page.getByRole('group', { name: en.list.filterByType });
  await typeFilter.getByRole('button', { name: /^Webhook/ }).click();

  await expect(page).toHaveURL(/\/jobs\?type=webhook$/);
  await expect(page.getByRole('link', { name: webhook.id.slice(0, 8) })).toBeVisible();
  await expect(page.getByRole('link', { name: email.id.slice(0, 8) })).toHaveCount(0);
  // Every row left is a webhook job: its Type cell (the second column) reads the job's type.
  const rows = page.getByRole('row').filter({ has: page.getByRole('link') });
  for (const row of await rows.all()) {
    await expect(row.getByRole('cell').nth(1)).toHaveText('webhook');
  }
  // The button shows job-service's faceted count of webhook jobs under the chosen filters.
  const stats = QueueStats.parse(
    await (await request.get(`${JOB_SERVICE_URL}${STATS_ROUTE}?type=webhook`)).json(),
  );
  expect(stats.counts.type.webhook).toBeGreaterThanOrEqual(1);
  await expect(typeFilter.getByRole('button', { name: /^Webhook [\d,]+$/ })).toHaveText(
    `Webhook ${stats.counts.type.webhook.toLocaleString('en-US')}`,
  );
});

test.describe('job log', () => {
  const submitEmailJob = async (request: APIRequestContext, subject: string): Promise<string> => {
    const submitted = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
      data: { type: 'email', payload: { to: 'ada@example.com', subject, body: 'Hi Ada' } },
    });
    expect(submitted.status()).toBe(201);
    return Job.parse(await submitted.json()).id;
  };
  const jobStatus = async (request: APIRequestContext, id: string): Promise<string> =>
    Job.parse(await (await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}`)).json()).status;
  // One page holds a single run's entries.
  const jobLog = async (request: APIRequestContext, id: string): Promise<JobLogEntry[]> => {
    const response = await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}/logs`);
    expect(response.status()).toBe(200);
    return QueryJobLogResponse.parse(await response.json()).items;
  };
  const messages = (entries: JobLogEntry[]): string[] => entries.map((entry) => entry.message);

  test('Run of an attempt is logged, Entry fields: through the stack, job-service steps and the worker steps with its instance id', async ({
    request,
  }) => {
    const id = await submitEmailJob(request, 'Logged');
    await expect.poll(() => jobStatus(request, id), { timeout: 30_000 }).toBe('completed');

    // Entries reach the log in batches, so they may show up a little after the job completes.
    await expect
      .poll(async () => messages(await jobLog(request, id)), { timeout: 30_000 })
      .toEqual(
        expect.arrayContaining([
          'Job submitted',
          'Attempt queued',
          'Attempt started',
          'Attempt picked up',
          'Handler started',
          'Handler finished',
          'Job completed',
        ]),
      );
    const entries = await jobLog(request, id);
    const steps = entries.map((entry) => `${entry.source}: ${entry.message}`);
    // Each step once: two workers, the stream and the writer store nothing twice.
    for (const step of new Set(steps)) {
      expect(
        steps.filter((s) => s === step),
        step,
      ).toHaveLength(1);
    }
    expect(entries.find((entry) => entry.message === 'Job submitted')).toMatchObject({
      source: 'job-service',
      attempt: null,
      level: 'info',
    });
    const pickup = entries.find((entry) => entry.message === 'Attempt picked up');
    expect(pickup).toMatchObject({ source: 'job-execution-service', attempt: 1 });
    // The worker's own instance id (its container's), not a service name.
    expect(pickup?.instanceId).toMatch(/^(?!job-(execution-)?service$)\S+$/);
    // Oldest first: the submission, then the worker's steps in the order they happened.
    expect(steps[0]).toBe('job-service: Job submitted');
    const at = (step: string): number => steps.indexOf(`job-execution-service: ${step}`);
    expect(at('Attempt picked up')).toBeLessThan(at('Handler finished'));
    expect(at('Handler finished')).toBeLessThan(at('Job completed'));
  });

  test('Log store down while a job runs: the job completes, and its log appears once the store is back', async ({
    request,
  }) => {
    await stack.stop({ service: 'clickhouse' });
    try {
      const id = await submitEmailJob(request, 'Logged while the store is down');
      await expect.poll(() => jobStatus(request, id), { timeout: 30_000 }).toBe('completed');

      const unavailable = await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}/logs`);
      expect(unavailable.status()).toBe(503);
      expect(ErrorBody.parse(await unavailable.json()).code).toBe('LOG_STORE_UNAVAILABLE');

      await stack.start({ service: 'clickhouse' });
      // The writer retries its batch with a growing wait (up to the configured maximum).
      await expect
        .poll(async () => messages(await jobLog(request, id)), { timeout: 90_000 })
        .toEqual(expect.arrayContaining(['Job submitted', 'Attempt picked up', 'Job completed']));
      // The batch retried while the store was down is stored once.
      const steps = (await jobLog(request, id)).map((entry) => `${entry.source}: ${entry.message}`);
      expect(steps.filter((step) => step === 'job-service: Job submitted')).toHaveLength(1);
      expect(steps.filter((step) => step === 'job-service: Job completed')).toHaveLength(1);
    } finally {
      await stack.start({ service: 'clickhouse' });
    }
  });
});

test('Cancelled waiting job never runs: a worker takes its entry, skips it, and it stays cancelled', async ({
  request,
}) => {
  const jobs = new StackJobs({ request });
  const { job } = await jobs.waiting();

  const { response } = await jobs.changeStatus({ id: job.id, status: 'cancelled' });

  expect(response.status()).toBe(200);
  expect(Job.parse(await response.json()).status).toBe('cancelled');
  // A worker reaches its entry once the backlog ahead of it is done, and drops it unrun.
  await expect
    .poll(
      async () =>
        (await jobs.workerLogged({ jobId: job.id, msg: 'Skipped: job is no longer startable' }))
          .lines,
      { timeout: 90_000, intervals: [1_000] },
    )
    .toContainEqual(expect.objectContaining({ status: 'cancelled' }));
  expect((await jobs.workerLogged({ jobId: job.id, msg: 'Job started' })).lines).toEqual([]);
  expect((await jobs.read({ id: job.id })).job).toMatchObject({
    status: 'cancelled',
    attempts: 0,
    startedAt: null,
    result: null,
  });
});

test('Running job is stopped on the full system: its worker logged the stop and it stays cancelled without a result', async ({
  request,
}) => {
  const jobs = new StackJobs({ request });
  // A send may end just before the cancel arrives (409); then another job is tried.
  let cancelled: Job | undefined;
  for (let tries = 0; tries < 5 && cancelled === undefined; tries += 1) {
    const { job: running } = await jobs.running();
    const { response } = await jobs.changeStatus({ id: running.id, status: 'cancelled' });
    expect([200, 409]).toContain(response.status());
    if (response.status() === 200) cancelled = Job.parse(await response.json());
  }
  if (cancelled === undefined) throw new Error('No running job could be cancelled');
  const { id } = cancelled;

  // The worker logs the stop once its handler was aborted, after which it reports nothing more.
  await expect
    .poll(
      async () =>
        (await jobs.workerLogged({ jobId: id, msg: 'Stopped: the job was cancelled' })).lines
          .length,
      { timeout: 15_000 },
    )
    .toBe(1);
  expect((await jobs.workerLogged({ jobId: id, msg: 'Job completed' })).lines).toEqual([]);
  expect((await jobs.read({ id })).job).toMatchObject({
    status: 'cancelled',
    result: null,
    error: null,
  });
});

test('Retried job runs again on the full system: back to pending with zero attempts, then finished again', async ({
  request,
}) => {
  const jobs = new StackJobs({ request });
  const { job: failed } = await jobs.failed();

  const { response } = await jobs.changeStatus({ id: failed.id, status: 'pending' });

  expect(response.status()).toBe(200);
  expect(Job.parse(await response.json())).toMatchObject({
    status: 'pending',
    attempts: 0,
    error: null,
    completedAt: null,
  });
  await expect
    .poll(async () => (await jobs.read({ id: failed.id })).job.status, { timeout: 60_000 })
    .toMatch(/^(completed|failed)$/);
  expect((await jobs.read({ id: failed.id })).job.attempts).toBe(1);
});

test.describe('reliability', () => {
  /** An email job of a bulk, numbered so the jobs of one test are told apart. */
  const emailItem = (subject: string, index: number): Record<string, unknown> => ({
    type: 'email',
    payload: { to: 'ada@example.com', subject: `${subject} ${index}`, body: 'Hi Ada' },
  });

  /** job-service's log lines, parsed. */
  // Its JSON log lines; the few that are not JSON (output before the logger is up) are skipped.
  const jobServiceLog = async (): Promise<Record<string, unknown>[]> =>
    (await stack.logs({ service: 'job-service' })).lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });

  test('Bulk retried after a lost answer on the full system: the same jobs answer 200, and exist once', async ({
    request,
  }) => {
    const jobs = new StackJobs({ request });
    const groupId = randomUUID();
    const items = [0, 1, 2].map((index) => ({
      ...emailItem('Keyed', index),
      groupId,
      idempotencyKey: `${groupId}-${index}`,
    }));

    const first = await jobs.submitBulk({ jobs: items });
    const second = await jobs.submitBulk({ jobs: items });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.jobs.map((job) => job.id)).toEqual(first.jobs.map((job) => job.id));
    const query = await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}?groupId=${groupId}`);
    expect(QueryJobsResponse.parse(await query.json()).total).toBe(items.length);
  });

  test('Cancel a job waiting for its retry on the full system: it stays cancelled once its retry time has passed', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const jobs = new StackJobs({ request });
    const groupId = randomUUID();
    // Enough webhook jobs that the stack's simulated failure rate fails some first attempts.
    await jobs.submitBulk({
      jobs: Array.from({ length: 40 }, (_value, index) => ({
        type: 'webhook',
        payload: { method: 'POST', url: `https://hooks.example.com/retry-${index}` },
        maxAttempts: 3,
        groupId,
      })),
    });
    const waitingForRetry = `${JOB_SERVICE_URL}${JOBS_ROUTE}?groupId=${groupId}&status=scheduled&limit=10`;

    // A job is caught while it waits for its retry: the cancel answers it with the start of the
    // failed attempt, so no later attempt had begun. Another waiting job is tried otherwise.
    let cancelled: Job | undefined;
    await expect
      .poll(
        async () => {
          const { items } = QueryJobsResponse.parse(
            await (await request.get(waitingForRetry)).json(),
          );
          for (const candidate of items.filter((job) => job.error !== null)) {
            const { response } = await jobs.changeStatus({ id: candidate.id, status: 'cancelled' });
            if (response.status() !== 200) continue;
            const job = Job.parse(await response.json());
            if (job.startedAt === candidate.startedAt && job.attempts === candidate.attempts) {
              cancelled = { ...job, scheduledAt: candidate.scheduledAt };
              return true;
            }
          }
          return false;
        },
        { timeout: 90_000, intervals: [100] },
      )
      .toBe(true);
    if (cancelled === undefined) throw new Error('No job was caught waiting for its retry');
    const { id, attempts } = cancelled;

    // Past its retry time (plus a pass of the recovery) the next attempt has still not run.
    const retryAt = Date.parse(cancelled.scheduledAt ?? '');
    await expect
      .poll(() => Date.now() > retryAt + 5_000, { timeout: 30_000, intervals: [500] })
      .toBe(true);
    expect((await jobs.read({ id })).job).toMatchObject({ status: 'cancelled', attempts });
    // The next attempt's entry is still taken by a worker, which finds the job cancelled and skips
    // it without starting it.
    const nextAttempt = attempts + 1;
    await expect
      .poll(
        async () =>
          (
            await jobs.workerLogged({ jobId: id, msg: 'Skipped: job is no longer startable' })
          ).lines.filter((entry) => entry.attempt === nextAttempt),
        { timeout: 15_000, intervals: [500] },
      )
      .toEqual([expect.objectContaining({ status: 'cancelled' })]);
    expect(
      (await jobs.workerLogged({ jobId: id, msg: 'Job started' })).lines.filter(
        (entry) => entry.attempt === nextAttempt,
      ),
    ).toEqual([]);
  });

  test("Killed worker's job is recovered on the full system: every job completes, a lost attempt is run again", async ({
    request,
  }) => {
    test.setTimeout(240_000);
    const jobs = new StackJobs({ request });
    const { jobs: submitted } = await jobs.submitBulk({
      jobs: Array.from({ length: 30 }, (_value, index) => emailItem('Survives a crash', index)),
    });
    const ids = submitted.map((job) => job.id);
    const { containers } = await stack.containers({ service: 'job-execution-service' });
    const victim = containers[0];
    if (victim === undefined) throw new Error('No execution instance is running');

    try {
      // Kill an instance while every instance is busy: most of the stack's slots are taken.
      await expect
        .poll(
          async () => {
            const read = await Promise.all(
              ids.map(async (jobId) => (await jobs.read({ id: jobId })).job),
            );
            return read.filter((job) => job.status === 'processing').length;
          },
          { timeout: 60_000, intervals: [100] },
        )
        .toBeGreaterThanOrEqual(12);
      await stack.kill({ container: victim.name });

      const { jobs: finished } = await jobs.finished({ ids, timeoutMs: 180_000 });

      for (const job of finished) expect(job).toMatchObject({ status: 'completed', error: null });
      const rerun = finished.filter((job) => job.attempts > 1);
      expect(rerun.length).toBeGreaterThan(0);
      const lost = (await jobServiceLog()).filter(
        (entry) => entry.reason === JOB_ERROR_CODES.workerLost && ids.includes(String(entry.jobId)),
      );
      expect(lost.map((entry) => entry.jobId)).toEqual(
        expect.arrayContaining(rerun.map((job) => job.id)),
      );
    } finally {
      // The rest of the suite expects every instance up again.
      await stack.start({ service: 'job-execution-service' });
    }
  });

  test('Pending job recovers on the full system: jobs whose queue entries were lost are queued again and complete', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const jobs = new StackJobs({ request });
    const { jobs: submitted } = await jobs.submitBulk({
      jobs: Array.from({ length: 40 }, (_value, index) => emailItem('Lost entry', index)),
    });
    const ids = submitted.map((job) => job.id);

    // The queue loses everything it held, while most of the jobs still wait.
    await stack.exec({ service: 'redis', command: ['redis-cli', 'FLUSHALL'] });

    const { jobs: finished } = await jobs.finished({ ids, timeoutMs: 150_000 });

    for (const job of finished) expect(job.status).toBe('completed');
    const requeued = (await jobServiceLog()).filter(
      (entry) =>
        entry.msg === 'Recovery: waiting job queued again' && ids.includes(String(entry.jobId)),
    );
    expect(requeued.length).toBeGreaterThan(0);
  });
});
