import { fileURLToPath } from 'node:url';

import { CheckoutStackIdentity } from './checkout-stack-identity.js';

export const EXECUTION_INSTANCES = 3;

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
  INTERNAL_SERVICE_TOKEN: 'system-e2e-service-token',
  LOG_LEVEL: 'info',
  // Recovery in seconds, not the production half minute, so a killed worker's or a lost entry's
  // job is recovered within a test. The lock stays above a second or two of a busy event loop, so a
  // live worker is never taken for a dead one.
  JOB_SERVICE_RECOVERY_INTERVAL_MS: '2000',
  JOB_SERVICE_RECOVERY_MIN_AGE_MS: '2000',
  JOB_QUEUE_LOCK_DURATION_MS: '3000',
  JOB_QUEUE_STALLED_INTERVAL_MS: '2000',
  // Short retry waits, still long enough to catch a job while it waits for its retry.
  JOB_SERVICE_RETRY_MIN_DELAY_MS: '1000',
  JOB_SERVICE_RETRY_MAX_DELAY_MS: '2000',
  JOB_SERVICE_RETRY_CAP_DELAY_MS: '4000',
};

export const JOB_SERVICE_URL = `http://127.0.0.1:${ports.jobService}`;
export const JOB_UI_URL = `http://127.0.0.1:${ports.jobUi}`;
export const JOB_GROUP_SERVICE_URL = `http://127.0.0.1:${ports.jobGroupService}`;
