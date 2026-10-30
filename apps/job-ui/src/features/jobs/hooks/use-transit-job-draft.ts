import { SystemClock } from '@job-queue/kernel';
import { useMemo } from 'react';

import type { JobFormDraft } from '../model/job-form-draft';
import type { TransitFormField, TransitFormValues } from '../model/transit-form-values';
import { ZodTransitJobDraft } from '../model/zod-transit-job-draft';

/** The transit form's `JobFormDraft` the submit page and its form share. */
export function useTransitJobDraft(): JobFormDraft<TransitFormValues, TransitFormField> {
  return useMemo(() => new ZodTransitJobDraft({ clock: new SystemClock() }), []);
}
