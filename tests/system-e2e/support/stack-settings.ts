import { fileURLToPath } from 'node:url';

import { CheckoutStackIdentity } from './checkout-stack-identity.js';

export const EXECUTION_INSTANCES = 2;

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The suite's compose project and host ports, derived from this checkout: never the ones of a
 * developer's own `docker compose up`, nor of the suite running in another worktree.
 */
const { project, ports } = new CheckoutStackIdentity({ checkoutPath: REPO_ROOT }).identity();

export const COMPOSE_PROJECT = project;

/** The environment of every `docker compose` call of the suite (names as in `.env.example`). */
export const STACK_ENV: Readonly<Record<string, string>> = {
  JOB_SERVICE_PORT: String(ports.jobService),
  JOB_UI_PORT: String(ports.jobUi),
  JOB_GROUP_SERVICE_PORT: String(ports.jobGroupService),
  POSTGRES_PORT: String(ports.postgres),
  REDIS_PORT: String(ports.redis),
  CLICKHOUSE_HTTP_PORT: String(ports.clickhouse),
  INTERNAL_SERVICE_TOKEN: 'system-e2e-service-token',
  LOG_LEVEL: 'info',
};

export const JOB_SERVICE_URL = `http://127.0.0.1:${ports.jobService}`;
export const JOB_UI_URL = `http://127.0.0.1:${ports.jobUi}`;
export const JOB_GROUP_SERVICE_URL = `http://127.0.0.1:${ports.jobGroupService}`;
