import { fileURLToPath } from 'node:url';

/** The compose project of the suite, so it never touches a developer's own `docker compose up`. */
export const COMPOSE_PROJECT = 'scaffold-e2e';

export const EXECUTION_INSTANCES = 2;

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Host ports of the suite's stack: different from the defaults, so both can run side by side. */
export const JOB_SERVICE_HOST_PORT = 13_000;
export const JOB_UI_HOST_PORT = 18_080;

/** The environment of every `docker compose` call of the suite (names as in `.env.example`). */
export const STACK_ENV: Readonly<Record<string, string>> = {
  JOB_SERVICE_PORT: String(JOB_SERVICE_HOST_PORT),
  JOB_UI_PORT: String(JOB_UI_HOST_PORT),
  POSTGRES_PORT: '15432',
  REDIS_PORT: '16379',
  INTERNAL_SERVICE_TOKEN: 'system-e2e-service-token',
  LOG_LEVEL: 'info',
};

export const JOB_SERVICE_URL = `http://127.0.0.1:${JOB_SERVICE_HOST_PORT}`;
export const JOB_UI_URL = `http://127.0.0.1:${JOB_UI_HOST_PORT}`;
