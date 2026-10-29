import { defineConfig, devices } from '@playwright/test';

import { JOB_UI_URL } from './support/stack-settings.js';

/**
 * System e2e: the whole docker compose stack under its own project name (see `support/`), started
 * by the `stack-up` project and removed by `stack-down` even when a test fails.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: JOB_UI_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'stack-up', testMatch: 'stack.setup.ts', teardown: 'stack-down' },
    { name: 'stack-down', testMatch: 'stack.teardown.ts' },
    {
      name: 'system',
      testMatch: '*.spec.ts',
      dependencies: ['stack-up'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
