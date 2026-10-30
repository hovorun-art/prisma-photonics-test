/**
 * Path prefix of every job-service call from the browser. The Vite dev proxy and nginx in docker
 * compose strip it and forward the rest to job-service.
 */
export const API_BASE_PATH = '/api';

/**
 * The calls under this path go to job-group-service instead (its `JOB_GROUPS_ROUTE`); nginx routes
 * the same path. A literal, since `vite.config.ts` loads this file before the packages are built.
 */
export const GROUPS_API_PATH = `${API_BASE_PATH}/v1/groups`;
