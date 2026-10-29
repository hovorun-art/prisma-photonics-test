import { expect, test } from '@playwright/test';

import { API_BASE_PATH } from '../../src/config/api-base-path';
import { en } from '../../src/locales/en';

test('UI started: the page shows the application name and the started message', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: en.appShell.name })).toBeVisible();
  await expect(page.getByText(en.appShell.started)).toBeVisible();
});

test('Backend not needed: the page loads without any request to the backend', async ({ page }) => {
  const backendCalls: string[] = [];
  await page.route(`**${API_BASE_PATH}/**`, async (route) => {
    backendCalls.push(route.request().url());
    await route.abort('connectionrefused');
  });

  await page.goto('/');

  await expect(page.getByText(en.appShell.started)).toBeVisible();
  expect(backendCalls).toEqual([]);
});
