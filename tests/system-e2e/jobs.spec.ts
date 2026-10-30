import {
  EmailJobResult,
  ErrorBody,
  JOBS_ROUTE,
  Job,
  type JobLogEntry,
  QueryJobLogResponse,
  QueueStats,
  STATS_ROUTE,
} from '@job-queue/contracts';
import { expect, test } from '@playwright/test';

import { en } from '../../apps/job-ui/src/locales/en.js';
import { stack } from './support/running-stack.js';
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

test('Run of an attempt is logged, Entry fields: through the stack, job-service steps and the worker steps with its instance id', async ({
  request,
}) => {
  const submitEmailJob = async (subject: string): Promise<string> => {
    const submitted = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
      data: { type: 'email', payload: { to: 'ada@example.com', subject, body: 'Hi Ada' } },
    });
    expect(submitted.status()).toBe(201);
    return Job.parse(await submitted.json()).id;
  };
  const jobStatus = async (id: string): Promise<string> =>
    Job.parse(await (await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}`)).json()).status;
  // One page holds a single run's entries.
  const jobLog = async (id: string): Promise<JobLogEntry[]> => {
    const response = await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}/logs`);
    expect(response.status()).toBe(200);
    return QueryJobLogResponse.parse(await response.json()).items;
  };
  const messages = (entries: JobLogEntry[]): string[] => entries.map((entry) => entry.message);

  const id = await submitEmailJob('Logged');
  await expect.poll(() => jobStatus(id), { timeout: 30_000 }).toBe('completed');

  // Entries reach the log in batches, so they may show up a little after the job completes.
  await expect
    .poll(async () => messages(await jobLog(id)), { timeout: 30_000 })
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
  const entries = await jobLog(id);
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
  const submitEmailJob = async (subject: string): Promise<string> => {
    const submitted = await request.post(`${JOB_SERVICE_URL}${JOBS_ROUTE}`, {
      data: { type: 'email', payload: { to: 'ada@example.com', subject, body: 'Hi Ada' } },
    });
    expect(submitted.status()).toBe(201);
    return Job.parse(await submitted.json()).id;
  };
  const jobStatus = async (id: string): Promise<string> =>
    Job.parse(await (await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}`)).json()).status;
  // One page holds a single run's entries.
  const jobLog = async (id: string): Promise<JobLogEntry[]> => {
    const response = await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}/logs`);
    expect(response.status()).toBe(200);
    return QueryJobLogResponse.parse(await response.json()).items;
  };
  const messages = (entries: JobLogEntry[]): string[] => entries.map((entry) => entry.message);

  await stack.stop({ service: 'clickhouse' });
  try {
    const id = await submitEmailJob('Logged while the store is down');
    await expect.poll(() => jobStatus(id), { timeout: 30_000 }).toBe('completed');

    const unavailable = await request.get(`${JOB_SERVICE_URL}${JOBS_ROUTE}/${id}/logs`);
    expect(unavailable.status()).toBe(503);
    expect(ErrorBody.parse(await unavailable.json()).code).toBe('LOG_STORE_UNAVAILABLE');

    await stack.start({ service: 'clickhouse' });
    // The writer retries its batch with a growing wait (up to the configured maximum).
    await expect
      .poll(async () => messages(await jobLog(id)), { timeout: 90_000 })
      .toEqual(expect.arrayContaining(['Job submitted', 'Attempt picked up', 'Job completed']));
    // The batch retried while the store was down is stored once.
    const steps = (await jobLog(id)).map((entry) => `${entry.source}: ${entry.message}`);
    expect(steps.filter((step) => step === 'job-service: Job submitted')).toHaveLength(1);
    expect(steps.filter((step) => step === 'job-service: Job completed')).toHaveLength(1);
  } finally {
    await stack.start({ service: 'clickhouse' });
  }
});
