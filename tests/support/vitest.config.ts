import { defineConfig } from 'vitest/config';

import { packageProjects } from '../../tooling/vitest/presets.js';

export default defineConfig({
  test: { projects: packageProjects('test-support') },
});
