import { EMAIL_LIMITS, JOB_LIMITS, ValidationFailedDetails } from '@job-queue/contracts';

import { en } from '@/locales';

import { EMAIL_FORM_FIELDS, type EmailFormField } from './email-form-values';
import type {
  ApiErrorsEmailJobDraftRequest,
  ApiErrorsEmailJobDraftResponse,
  EmailFormErrors,
  EmailJobDraft,
  FieldMessageEmailJobDraftRequest,
  FieldMessageEmailJobDraftResponse,
} from './email-job-draft';

const FORM_FIELDS: ReadonlySet<string> = new Set(EMAIL_FORM_FIELDS);

/** `EmailJobDraft` for the shared Zod schemas, with the strings from `locales/en.ts`. */
export class ZodEmailJobDraft implements EmailJobDraft {
  fieldMessage({
    field,
    values,
  }: FieldMessageEmailJobDraftRequest): FieldMessageEmailJobDraftResponse {
    switch (field) {
      case 'payload.to':
        return { message: en.submit.errors.to };
      case 'payload.subject':
        return {
          message:
            values.payload.subject === ''
              ? en.submit.errors.subjectRequired
              : en.submit.errors.subjectTooLong(EMAIL_LIMITS.subjectMaxLength),
        };
      case 'payload.body':
        return { message: en.submit.errors.bodyTooLong(EMAIL_LIMITS.bodyMaxLength) };
      case 'priority':
        return {
          message: en.submit.errors.priority(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max),
        };
      case 'maxAttempts':
        return {
          message: en.submit.errors.maxAttempts(
            JOB_LIMITS.maxAttempts.min,
            JOB_LIMITS.maxAttempts.max,
          ),
        };
    }
  }

  apiErrors({ details }: ApiErrorsEmailJobDraftRequest): ApiErrorsEmailJobDraftResponse {
    const parsed = ValidationFailedDetails.safeParse(details);
    const errors: EmailFormErrors = {};
    const unmatched: string[] = [];
    for (const issue of parsed.success ? parsed.data.issues : []) {
      const path = issue.path.join('.');
      if (this.isFormField(path)) errors[path] ??= issue.message;
      else unmatched.push(issue.message);
    }
    return { errors, unmatched };
  }

  private isFormField(path: string): path is EmailFormField {
    return FORM_FIELDS.has(path);
  }
}
