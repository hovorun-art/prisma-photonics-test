import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config: `npm test` runs every workspace's projects (unit, integration and backend
 * per-app e2e). Projects are named `<package> (<app>:<level>)`: run one level with
 * `--project '*:unit)'` (or `npm run test:unit`), one app with `--project '*(job-service:*'`.
 * Inside a workspace the names are short: `npm test -w apps/job-service -- --project job-service:e2e`.
 * Playwright suites (job-ui per-app e2e, tests/system-e2e) run through `npm run test:e2e`.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      'tests/*/vitest.config.ts',
      'tools/*/vitest.config.ts',
    ],
  },
});
