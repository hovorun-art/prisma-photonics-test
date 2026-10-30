import { expect, test } from '@playwright/test';

import { en } from '../../apps/job-ui/src/locales/en.js';

test('Submit an email job, see it in the list, open its page and see it completed', async ({
  page,
}) => {
  const subject = `System e2e ${Date.now()}`;

  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: en.frame.newJob }).click();
  await page.getByLabel(en.submit.to, { exact: true }).fill('ops@acme.test');
  await page.getByLabel(en.submit.subject, { exact: true }).fill(subject);
  await page.getByLabel(en.submit.body, { exact: true }).fill('Sent by the system e2e');
  await page.getByRole('button', { name: en.submit.submit }).click();

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  const id = page.url().split('/jobs/')[1]!;
  await expect(page.getByRole('heading', { level: 1, name: id })).toBeVisible();

  await page
    .getByRole('navigation', { name: en.frame.navLabel })
    .getByRole('link', { name: en.frame.jobs })
    .click();
  // Found by its id: the Details column swaps the subject for the message id once the job completes.
  await page.getByRole('link', { name: id.slice(0, 8) }).click();

  await expect(page.getByRole('heading', { level: 1, name: id })).toBeVisible();
  await expect(page.getByRole('region', { name: en.job.payload })).toContainText(subject);

  // A job-execution-service instance runs it; the page polls until the result arrives.
  await expect(page.getByRole('region', { name: en.job.result })).toContainText('messageId', {
    timeout: 30_000,
  });
  await expect(page.getByText(en.statuses.completed, { exact: true }).first()).toBeVisible();
});

test('API proxy: /api/health through nginx reaches job-service with the prefix stripped', async ({
  request,
}) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
