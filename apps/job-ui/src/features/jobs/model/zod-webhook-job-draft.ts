import {
  CreateWebhookJobRequest,
  JsonObject,
  WEBHOOK_LIMITS,
  WEBHOOK_METHODS,
  WebhookJobPayload,
} from '@job-queue/contracts';
import { z } from 'zod';

import { en } from '@/locales';

import type {
  ApiErrorsJobFormDraftRequest,
  ApiErrorsJobFormDraftResponse,
  EmptyValuesJobFormDraftRequest,
  EmptyValuesJobFormDraftResponse,
  FieldMessageJobFormDraftRequest,
  FieldMessageJobFormDraftResponse,
  JobFormDraft,
  PreviewRequestJobFormDraftRequest,
  PreviewRequestJobFormDraftResponse,
  SchemaJobFormDraftResponse,
} from './job-form-draft';
import { LocaleExecutionFieldMessages } from './execution-field-messages';
import { ValidationIssueMapper } from './validation-issue-mapper';
import {
  WEBHOOK_FORM_FIELDS,
  type WebhookFormField,
  type WebhookFormValues,
} from './webhook-form-values';

/**
 * The webhook job's submit form for the shared Zod schemas, with the strings from `locales/en.ts`.
 * The body is typed as text: blank sends no body, anything else must parse to a JSON object.
 */
export class ZodWebhookJobDraft implements JobFormDraft<WebhookFormValues, WebhookFormField> {
  readonly fields = WEBHOOK_FORM_FIELDS;
  private readonly execution = new LocaleExecutionFieldMessages();
  private readonly issues = new ValidationIssueMapper({ fields: WEBHOOK_FORM_FIELDS });
  private readonly form = this.formSchema();

  emptyValues({
    execution,
  }: EmptyValuesJobFormDraftRequest): EmptyValuesJobFormDraftResponse<WebhookFormValues> {
    return {
      values: { type: 'webhook', payload: { method: 'POST', url: '', body: '' }, ...execution },
    };
  }

  schema(): SchemaJobFormDraftResponse<WebhookFormValues> {
    return { schema: this.form };
  }

  fieldMessage({
    field,
    values,
  }: FieldMessageJobFormDraftRequest<
    WebhookFormValues,
    WebhookFormField
  >): FieldMessageJobFormDraftResponse {
    switch (field) {
      case 'payload.method':
        return { message: en.submit.errors.method(WEBHOOK_METHODS.join(', ')) };
      case 'payload.url':
        return {
          message:
            values.payload.url.length > WEBHOOK_LIMITS.urlMaxLength
              ? en.submit.errors.urlTooLong(WEBHOOK_LIMITS.urlMaxLength)
              : en.submit.errors.url,
        };
      case 'payload.body':
        return {
          message:
            this.parse(values.payload.body) === undefined
              ? en.submit.errors.jsonInvalid
              : en.submit.errors.jsonNotObject,
        };
      case 'priority':
      case 'maxAttempts':
        return this.execution.message({ field });
    }
  }

  apiErrors(req: ApiErrorsJobFormDraftRequest): ApiErrorsJobFormDraftResponse<WebhookFormField> {
    return this.issues.map(req);
  }

  previewRequest({
    values,
  }: PreviewRequestJobFormDraftRequest<WebhookFormValues>): PreviewRequestJobFormDraftResponse {
    const { body, ...payload } = values.payload;
    if (this.isBlank(body)) return { request: { ...values, payload } };
    const parsed = this.parse(body);
    const shown = this.isObject(parsed) ? parsed : body;
    return { request: { ...values, payload: { ...payload, body: shown } } };
  }

  /** The contract's webhook request, with the body parsed from the typed text first. */
  private formSchema(): z.ZodType<z.output<typeof CreateWebhookJobRequest>, WebhookFormValues> {
    const body = z
      .string()
      .transform((text, ctx) => {
        if (this.isBlank(text)) return undefined;
        const parsed = this.parse(text);
        if (parsed !== undefined) return parsed;
        ctx.addIssue({ code: 'custom', message: en.submit.errors.jsonInvalid });
        return z.NEVER;
      })
      .pipe(JsonObject.optional());
    return CreateWebhookJobRequest.extend({ payload: WebhookJobPayload.extend({ body }) });
  }

  /** The JSON value of the text, or `undefined` when it is not valid JSON. */
  private parse(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isBlank(text: string): boolean {
    return text.trim() === '';
  }
}
