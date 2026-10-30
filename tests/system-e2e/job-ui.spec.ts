import { expect, test } from '@playwright/test';

import { en } from '../../apps/job-ui/src/locales/en.js';
import { StackJobs } from './support/stack-jobs.js';

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

test('Cancel a job from the UI on the full system: the page shows it cancelled, also after a reload', async ({
  page,
  request,
}) => {
  const { job } = await new StackJobs({ request }).waiting();
  await page.goto(`/jobs/${job.id}`);
  const header = page.getByRole('heading', { level: 1, name: job.id }).locator('../..');

  await header.getByRole('button', { name: en.job.cancelJob }).click();
  const dialog = page.getByRole('dialog', { name: en.job.cancelTitle });
  await dialog.getByRole('button', { name: en.job.cancelConfirm }).click();

  await expect(dialog).toBeHidden();
  await expect(header.getByText(en.statuses.cancelled, { exact: true })).toBeVisible();
  await page.reload();
  await expect(header.getByText(en.statuses.cancelled, { exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: en.job.cancelJob })).toBeHidden();
});

test('Retry a job from the UI on the full system: the page shows it leave failed, then finished again', async ({
  page,
  request,
}) => {
  const { job: failed } = await new StackJobs({ request }).failed();
  await page.goto(`/jobs/${failed.id}`);
  const header = page.getByRole('heading', { level: 1, name: failed.id }).locator('../..');
  await expect(header.getByText(en.statuses.failed, { exact: true })).toBeVisible();

  await header.getByRole('button', { name: en.job.retryJob }).click();

  // Shown from the retry's answer at once, before any worker has taken the job again.
  await expect(header.getByText(en.statuses.pending, { exact: true })).toBeVisible();
  await expect(header.getByText(en.statuses.failed, { exact: true })).toBeHidden();
  // The page polls until a worker has run the job again; a webhook may fail again, by design.
  await expect(
    header.getByText(new RegExp(`^(${en.statuses.completed}|${en.statuses.failed})$`)),
  ).toBeVisible({ timeout: 60_000 });
});
