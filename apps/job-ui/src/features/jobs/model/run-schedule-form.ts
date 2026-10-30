import type { z } from 'zod';

import type { RunScheduleValues } from './run-schedule';

export interface SchemaRunScheduleFormRequest<Request, Values> {
  /** The job type's own form schema, for the values without the run choice. */
  readonly request: z.ZodType<Request, Values>;
}
export interface SchemaRunScheduleFormResponse<Request, Values> {
  /** Checks the type's values and the run choice together, and sends the time as `scheduledAt`. */
  readonly schema: z.ZodType<Request, Values & RunScheduleValues>;
}
export interface PreviewRunScheduleFormRequest<Values> {
  readonly values: Values & RunScheduleValues;
}
export interface PreviewRunScheduleFormResponse<Values> {
  /** The values without the run choice, with `scheduledAt` only when the form will send one. */
  readonly values: Omit<Values, 'run' | 'scheduledAt'> & { readonly scheduledAt?: string };
}

/** Adds the run choice to a job type's submit form: its check, its request field and its preview. */
export interface RunScheduleForm {
  schema<Request, Values>(
    req: SchemaRunScheduleFormRequest<Request, Values>,
  ): SchemaRunScheduleFormResponse<Request, Values>;
  preview<Values>(
    req: PreviewRunScheduleFormRequest<Values>,
  ): PreviewRunScheduleFormResponse<Values>;
}
