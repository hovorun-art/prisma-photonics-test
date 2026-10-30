import { useContext } from 'react';

import { JobsApiContext } from './jobs-api-context';
import type { JobsApi } from './jobs-api';

/** The `JobsApi` provided by `JobsApiContext`. */
export function useJobsApi(): JobsApi {
  const api = useContext(JobsApiContext);
  if (!api) throw new TypeError('useJobsApi needs a JobsApiContext provider');
  return api;
}
