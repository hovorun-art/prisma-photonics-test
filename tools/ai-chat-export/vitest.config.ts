import { defineConfig } from 'vitest/config';

import { nestPackageProjects } from '../../tooling/vitest/presets.js';

// Unit and integration projects (the adapters run against the real filesystem and git); no
// plugins, since there is no NestJS code here.
export default defineConfig({
  test: { projects: nestPackageProjects('ai-chat-export', []) },
});
