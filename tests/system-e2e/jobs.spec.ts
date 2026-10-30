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
