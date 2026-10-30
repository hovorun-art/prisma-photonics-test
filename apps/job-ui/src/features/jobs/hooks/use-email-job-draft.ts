import { useMemo } from 'react';

import type { EmailJobDraft } from '../model/email-job-draft';
import { ZodEmailJobDraft } from '../model/zod-email-job-draft';

/** The `EmailJobDraft` the submit page and its form share. */
export function useEmailJobDraft(): EmailJobDraft {
  return useMemo(() => new ZodEmailJobDraft(), []);
}
