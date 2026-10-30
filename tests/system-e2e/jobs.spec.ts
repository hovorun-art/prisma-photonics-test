import { EmailJobResult, JOBS_ROUTE, Job, QueueStats, STATS_ROUTE } from '@job-queue/contracts';
import { expect, test } from '@playwright/test';

import { en } from '../../apps/job-ui/src/locales/en.js';
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
