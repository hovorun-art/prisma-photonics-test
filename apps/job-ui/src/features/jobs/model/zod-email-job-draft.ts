import { CreateEmailJobRequest, EMAIL_LIMITS } from '@job-queue/contracts';

import { en } from '@/locales';

import {
  EMAIL_FORM_FIELDS,
  EMPTY_EMAIL_FORM,
  type EmailFormField,
  type EmailFormValues,
} from './email-form-values';
import type { EmailJobDraft } from './email-job-draft';
import type {
  ApiErrorsJobFormDraftRequest,
  ApiErrorsJobFormDraftResponse,
  EmptyValuesJobFormDraftRequest,
  EmptyValuesJobFormDraftResponse,
  FieldMessageJobFormDraftRequest,
  FieldMessageJobFormDraftResponse,
  PreviewRequestJobFormDraftRequest,
  PreviewRequestJobFormDraftResponse,
  SchemaJobFormDraftResponse,
} from './job-form-draft';
import { LocaleExecutionFieldMessages } from './execution-field-messages';
import type { RunSchedule } from './run-schedule';
import { ValidationIssueMapper } from './validation-issue-mapper';
import { ZodRunScheduleForm } from './zod-run-schedule-form';

export interface ZodEmailJobDraftDeps {
  readonly runSchedule: RunSchedule;
}

/** `EmailJobDraft` for the shared Zod schemas, with the strings from `locales/en.ts`. */
export class ZodEmailJobDraft implements EmailJobDraft {
  readonly fields = EMAIL_FORM_FIELDS;
  private readonly execution = new LocaleExecutionFieldMessages();
  private readonly issues = new ValidationIssueMapper({ fields: EMAIL_FORM_FIELDS });
  private readonly runScheduleForm: ZodRunScheduleForm;
  private readonly form: SchemaJobFormDraftResponse<EmailFormValues>['schema'];

  constructor(private readonly d: ZodEmailJobDraftDeps) {
    this.runScheduleForm = new ZodRunScheduleForm({ runSchedule: d.runSchedule });
    // The same schema job-service validates with, plus the run choice.
    this.form = this.runScheduleForm.schema({ request: CreateEmailJobRequest }).schema;
  }

  emptyValues({
    execution,
  }: EmptyValuesJobFormDraftRequest): EmptyValuesJobFormDraftResponse<EmailFormValues> {
    return { values: { ...EMPTY_EMAIL_FORM, ...execution } };
  }

  schema(): SchemaJobFormDraftResponse<EmailFormValues> {
    return { schema: this.form };
  }

  fieldMessage({
    field,
    values,
  }: FieldMessageJobFormDraftRequest<
    EmailFormValues,
    EmailFormField
  >): FieldMessageJobFormDraftResponse {
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
      case 'maxAttempts':
        return this.execution.message({ field });
      case 'scheduledAt':
        return this.d.runSchedule.message({ run: values.run, scheduledAt: values.scheduledAt });
    }
  }

  apiErrors(req: ApiErrorsJobFormDraftRequest): ApiErrorsJobFormDraftResponse<EmailFormField> {
    return this.issues.map(req);
  }

  previewRequest({
    values,
  }: PreviewRequestJobFormDraftRequest<EmailFormValues>): PreviewRequestJobFormDraftResponse {
    return { request: this.runScheduleForm.preview({ values }).values };
  }
}
