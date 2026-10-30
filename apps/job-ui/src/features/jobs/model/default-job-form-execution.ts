import { JOB_LIMITS } from '@job-queue/contracts';

import type { JobFormExecution } from './job-form-draft';

/** The execution settings a new job form starts with: the API's defaults, run immediately. */
export const DEFAULT_JOB_FORM_EXECUTION: JobFormExecution = {
  priority: JOB_LIMITS.priority.default,
  maxAttempts: JOB_LIMITS.maxAttempts.default,
  run: 'now',
  scheduledAt: '',
};
