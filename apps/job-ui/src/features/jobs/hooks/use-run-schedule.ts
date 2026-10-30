import { SystemClock } from '@job-queue/kernel';
import { useMemo } from 'react';

import { LocalRunSchedule } from '../model/local-run-schedule';
import type { RunSchedule } from '../model/run-schedule';

/** The run choice's rules on the browser's clock, shared by every job type's form. */
export function useRunSchedule(): RunSchedule {
  return useMemo(() => new LocalRunSchedule({ clock: new SystemClock() }), []);
}
