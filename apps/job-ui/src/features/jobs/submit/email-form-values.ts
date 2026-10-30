import { JOB_LIMITS } from '@job-queue/contracts';

/** What the email form holds while the user types; numbers stay text until they are checked. */
export interface EmailFormValues {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly priority: string;
  readonly maxAttempts: string;
}

export type EmailFormField = keyof EmailFormValues;

export const EMPTY_EMAIL_FORM: EmailFormValues = {
  to: '',
  subject: '',
  body: '',
  priority: String(JOB_LIMITS.priority.default),
  maxAttempts: String(JOB_LIMITS.maxAttempts.default),
};
