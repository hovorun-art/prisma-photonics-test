import { type CreateEmailJobRequest, JOB_LIMITS } from '@job-queue/contracts';
import type { z } from 'zod';

import type { RunScheduleValues } from './run-schedule';

/**
 * What the email form holds: the request it sends, except that the time to run is the run choice
 * and its local text. Field names are request paths.
 */
export type EmailFormValues = Omit<z.input<typeof CreateEmailJobRequest>, 'scheduledAt'> &
  RunScheduleValues;

/** The form's fields, named by their path in the request (as the API names it in validation issues). */
export const EMAIL_FORM_FIELDS = [
  'payload.to',
  'payload.subject',
  'payload.body',
  'priority',
  'maxAttempts',
  'scheduledAt',
] as const;
export type EmailFormField = (typeof EMAIL_FORM_FIELDS)[number];

export const EMPTY_EMAIL_FORM: EmailFormValues = {
  type: 'email',
  payload: { to: '', subject: '', body: '' },
  priority: JOB_LIMITS.priority.default,
  maxAttempts: JOB_LIMITS.maxAttempts.default,
  run: 'now',
  scheduledAt: '',
};
