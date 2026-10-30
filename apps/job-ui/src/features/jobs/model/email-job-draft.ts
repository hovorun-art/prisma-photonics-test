import type { EmailFormField, EmailFormValues } from './email-form-values';
import type { JobFormDraft, JobFormErrors } from './job-form-draft';

/** One message per email form field that has a problem. */
export type EmailFormErrors = JobFormErrors<EmailFormField>;

/** The email job's submit form. */
export type EmailJobDraft = JobFormDraft<EmailFormValues, EmailFormField>;
