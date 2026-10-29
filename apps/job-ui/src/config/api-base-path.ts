/**
 * Path prefix of every job-service call from the browser. The Vite dev proxy and nginx in docker
 * compose strip it and forward the rest to job-service.
 */
export const API_BASE_PATH = '/api';
