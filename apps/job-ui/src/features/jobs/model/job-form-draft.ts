import type { CreateJobRequest, JobType } from '@job-queue/contracts';
import type { z } from 'zod';

import type { JobRun } from './run-schedule';

/**
 * Priority, max attempts and when to run: the part of the form every job type shares and a type
 * switch keeps.
 */
export interface JobFormExecution {
  readonly priority: number;
  readonly maxAttempts: number;
  readonly run: JobRun;
  /** The `datetime-local` text of the time to run at, local time; empty until entered. */
  readonly scheduledAt: string;
}

/** The request the submit page previews: what will be sent, or as close to it as the form allows. */
export interface JobRequestPreview {
  readonly type: JobType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly priority?: unknown;
  readonly maxAttempts?: unknown;
  /** UTC ISO timestamp, only when the form will send one. */
  readonly scheduledAt?: string;
}

/** One message per form field that has a problem. */
export type JobFormErrors<Field extends string> = Partial<Record<Field, string>>;

export interface EmptyValuesJobFormDraftRequest {
  readonly execution: JobFormExecution;
}
export interface EmptyValuesJobFormDraftResponse<Values> {
  readonly values: Values;
}
export interface SchemaJobFormDraftResponse<Values> {
  /** Checks the form values and turns them into the request job-service accepts. */
  readonly schema: z.ZodType<CreateJobRequest, Values>;
}
export interface FieldMessageJobFormDraftRequest<Values, Field extends string> {
  /** The field the form schema rejected. */
  readonly field: Field;
  readonly values: Values;
}
export interface FieldMessageJobFormDraftResponse {
  readonly message: string;
}
export interface ApiErrorsJobFormDraftRequest {
  /** The `details` of a `VALIDATION_FAILED` answer. */
  readonly details: Readonly<Record<string, unknown>>;
}
export interface ApiErrorsJobFormDraftResponse<Field extends string> {
  readonly errors: JobFormErrors<Field>;
  /** Messages of issues that match no form field; the form shows them in its alert. */
  readonly unmatched: readonly string[];
}
export interface PreviewRequestJobFormDraftRequest<Values> {
  readonly values: Values;
}
export interface PreviewRequestJobFormDraftResponse {
  readonly request: JobRequestPreview;
}

/**
 * One job type's submit form: its fields, starting values, the schema that checks them, the
 * messages for a rejected field, where an API `VALIDATION_FAILED` answer belongs, and the preview.
 * Field names are request paths, as the API names them in validation issues.
 */
export interface JobFormDraft<Values, Field extends string> {
  readonly fields: readonly Field[];
  emptyValues(req: EmptyValuesJobFormDraftRequest): EmptyValuesJobFormDraftResponse<Values>;
  schema(): SchemaJobFormDraftResponse<Values>;
  /** job-ui's own message for a field the form schema rejected. */
  fieldMessage(
    req: FieldMessageJobFormDraftRequest<Values, Field>,
  ): FieldMessageJobFormDraftResponse;
  /** Maps an API `VALIDATION_FAILED` answer onto the form's fields, with the API's messages. */
  apiErrors(req: ApiErrorsJobFormDraftRequest): ApiErrorsJobFormDraftResponse<Field>;
  previewRequest(
    req: PreviewRequestJobFormDraftRequest<Values>,
  ): PreviewRequestJobFormDraftResponse;
}

export interface MapFieldIssuesRequest {
  /** The `details` of a `VALIDATION_FAILED` answer. */
  readonly details: Readonly<Record<string, unknown>>;
}
export type MapFieldIssuesResponse<Field extends string> = ApiErrorsJobFormDraftResponse<Field>;

/** Sorts the issues of an API `VALIDATION_FAILED` answer into form fields and the rest. */
export interface FieldIssues<Field extends string> {
  map(req: MapFieldIssuesRequest): MapFieldIssuesResponse<Field>;
}
