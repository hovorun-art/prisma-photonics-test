import { expect, test } from '@playwright/test';

import { en } from '../../apps/job-ui/src/locales/en.js';

test('UI started: the page served by nginx shows the application name and the started message', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: en.appShell.name })).toBeVisible();
  await expect(page.getByText(en.appShell.started)).toBeVisible();
});

test('API proxy: /api/health through nginx reaches job-service with the prefix stripped', async ({
  request,
}) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
