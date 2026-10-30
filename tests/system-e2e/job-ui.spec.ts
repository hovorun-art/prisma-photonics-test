import { expect, test } from '@playwright/test';

import { en } from '../../apps/job-ui/src/locales/en.js';

test('Submit an email job, see it in the list and open its page', async ({ page }) => {
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
  const row = page.getByRole('row').filter({ hasText: subject });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: id.slice(0, 8) }).click();

  await expect(page.getByRole('heading', { level: 1, name: id })).toBeVisible();
  await expect(page.getByRole('region', { name: en.job.payload })).toContainText(subject);
});

test('API proxy: /api/health through nginx reaches job-service with the prefix stripped', async ({
  request,
}) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
