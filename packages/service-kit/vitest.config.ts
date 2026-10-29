import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { nestPackageProjects } from '../../tooling/vitest/presets.js';

// SWC instead of esbuild: NestJS dependency injection needs emitted decorator metadata.
export default defineConfig({
  test: { projects: nestPackageProjects('service-kit', [swc.vite()]) },
});
