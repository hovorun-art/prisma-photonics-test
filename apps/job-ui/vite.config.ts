import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';

import { API_BASE_PATH } from './src/config/api-base-path.js';

/** One `.env` for the whole monorepo lives at the repository root (see `.env.example`). */
const envDir = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const proxyTarget = env.JOB_UI_API_PROXY_TARGET;
  const devPort = env.JOB_UI_DEV_PORT ? Number(env.JOB_UI_DEV_PORT) : undefined;

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      // Use the TypeScript sources of the shared packages, so no package build is needed first.
      conditions: ['@job-queue/source', ...defaultClientConditions],
    },
    server: {
      port: devPort,
      strictPort: devPort !== undefined,
      // Same-origin API calls: `/api/*` goes to job-service with the prefix removed (nginx does
      // the same in docker compose), so no CORS setup is needed.
      proxy: proxyTarget
        ? {
            [API_BASE_PATH]: {
              target: proxyTarget,
              changeOrigin: true,
              rewrite: (path) => path.slice(API_BASE_PATH.length),
            },
          }
        : undefined,
    },
  };
});
