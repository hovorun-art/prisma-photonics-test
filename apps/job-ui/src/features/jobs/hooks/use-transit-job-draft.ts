import { SystemClock } from '@job-queue/kernel';
import { useMemo } from 'react';

import type { JobFormDraft } from '../model/job-form-draft';
import type { TransitFormField, TransitFormValues } from '../model/transit-form-values';
import { ZodTransitJobDraft } from '../model/zod-transit-job-draft';
import { useRunSchedule } from './use-run-schedule';

/** The transit form's `JobFormDraft` the submit page and its form share. */
export function useTransitJobDraft(): JobFormDraft<TransitFormValues, TransitFormField> {
  const runSchedule = useRunSchedule();
  return useMemo(
    () => new ZodTransitJobDraft({ clock: new SystemClock(), runSchedule }),
    [runSchedule],
  );
}
