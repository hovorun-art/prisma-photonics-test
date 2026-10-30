import { EmailJobResult, JOBS_ROUTE, Job, QueueStats, STATS_ROUTE } from '@job-queue/contracts';
import { expect, test } from '@playwright/test';

import { en } from '../../apps/job-ui/src/locales/en.js';
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
