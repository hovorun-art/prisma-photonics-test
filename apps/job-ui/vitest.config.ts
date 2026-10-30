import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { uiProjects } from '../../tooling/vitest/presets.js';

export default defineConfig({
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    projects: uiProjects(
      'job-ui',
      [react()],
      [new URL('./src/test-setup.ts', import.meta.url).pathname],
    ),
  },
});
