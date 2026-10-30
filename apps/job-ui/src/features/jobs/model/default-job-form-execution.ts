import { JOB_LIMITS } from '@job-queue/contracts';

import type { JobFormExecution } from './job-form-draft';

/** Priority and max attempts a new job form starts with: the API's own defaults. */
export const DEFAULT_JOB_FORM_EXECUTION: JobFormExecution = {
  priority: JOB_LIMITS.priority.default,
  maxAttempts: JOB_LIMITS.maxAttempts.default,
};
