import { type CreateEmailJobRequest, JOB_LIMITS } from '@job-queue/contracts';
import type { z } from 'zod';

/** What the email form holds: the request it sends, so field names are request paths. */
export type EmailFormValues = z.input<typeof CreateEmailJobRequest>;

/** The form's fields, named by their path in the request (as the API names it in validation issues). */
export const EMAIL_FORM_FIELDS = [
  'payload.to',
  'payload.subject',
  'payload.body',
  'priority',
  'maxAttempts',
] as const;
export type EmailFormField = (typeof EMAIL_FORM_FIELDS)[number];

export const EMPTY_EMAIL_FORM: EmailFormValues = {
  type: 'email',
  payload: { to: '', subject: '', body: '' },
  priority: JOB_LIMITS.priority.default,
  maxAttempts: JOB_LIMITS.maxAttempts.default,
};
