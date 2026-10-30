import { useMemo } from 'react';

import { API_BASE_PATH } from '@/config';

import { CurlBuilder } from '../model/curl-builder';
import type { CurlCommands } from '../model/curl-commands';

/** curl commands against the API as this browser reaches it. */
export function useCurl(): CurlCommands {
  return useMemo(
    () => new CurlBuilder({ apiBaseUrl: `${window.location.origin}${API_BASE_PATH}` }),
    [],
  );
}
