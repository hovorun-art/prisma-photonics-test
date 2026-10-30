import { useContext } from 'react';

import { type UiConfig, UiConfigContext } from '@/config';

/** The tunable values of job-ui; tests provide shorter ones through `UiConfigContext`. */
export function useUiConfig(): UiConfig {
  return useContext(UiConfigContext);
}
