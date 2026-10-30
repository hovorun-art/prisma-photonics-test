import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { backendProjects } from '../../tooling/vitest/presets.js';

// SWC instead of esbuild: NestJS dependency injection needs emitted decorator metadata.
export default defineConfig({
  test: { projects: backendProjects('job-group-service', [swc.vite()]) },
});
