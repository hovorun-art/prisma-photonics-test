import type { EmailFormField, EmailFormValues } from './email-form-values';

/** One message per form field that has a problem. */
export type EmailFormErrors = Partial<Record<EmailFormField, string>>;

export interface FieldMessageEmailJobDraftRequest {
  /** The field the shared schema rejected. */
  readonly field: EmailFormField;
  readonly values: EmailFormValues;
}
export interface FieldMessageEmailJobDraftResponse {
  readonly message: string;
}
export interface ApiErrorsEmailJobDraftRequest {
  /** The `details` of a `VALIDATION_FAILED` answer. */
  readonly details: Readonly<Record<string, unknown>>;
}
export interface ApiErrorsEmailJobDraftResponse {
  readonly errors: EmailFormErrors;
  /** Messages of issues that match no form field; the form shows them in its alert. */
  readonly unmatched: readonly string[];
}

/**
 * The email form's messages. The form checks its values with the shared contract schema; this says
 * what to show for a rejected field and where an API `VALIDATION_FAILED` answer belongs.
 */
export interface EmailJobDraft {
  /** job-ui's own message for a field the shared schema rejected. */
  fieldMessage(req: FieldMessageEmailJobDraftRequest): FieldMessageEmailJobDraftResponse;
  /** Maps an API `VALIDATION_FAILED` answer onto the form's fields, with the API's messages. */
  apiErrors(req: ApiErrorsEmailJobDraftRequest): ApiErrorsEmailJobDraftResponse;
}
