import { defineConfig } from 'vitest/config';

/** Unit tests of the suite's own support code; the Playwright specs run through `test:e2e`. */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'system-e2e:unit',
          include: ['support/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
