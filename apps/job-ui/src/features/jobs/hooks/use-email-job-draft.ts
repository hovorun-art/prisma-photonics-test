import { useMemo } from 'react';

import type { EmailJobDraft } from '../model/email-job-draft';
import { ZodEmailJobDraft } from '../model/zod-email-job-draft';
import { useRunSchedule } from './use-run-schedule';

/** The `EmailJobDraft` the submit page and its form share. */
export function useEmailJobDraft(): EmailJobDraft {
  const runSchedule = useRunSchedule();
  return useMemo(() => new ZodEmailJobDraft({ runSchedule }), [runSchedule]);
}
