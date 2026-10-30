import { useMemo } from 'react';

import type { JobPresentation } from '../model/job-presentation';
import { JobPresenter } from '../model/job-presenter';
import { useUiConfig } from './use-ui-config';

/** The `JobPresentation` for the configured short id length. */
export function useJobPresenter(): JobPresentation {
  const { shortIdLength } = useUiConfig();
  return useMemo(() => new JobPresenter({ shortIdLength }), [shortIdLength]);
}
