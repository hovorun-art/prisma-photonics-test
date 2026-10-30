import { z } from 'zod';

import type { RunSchedule, RunScheduleValues } from './run-schedule';
import type {
  PreviewRunScheduleFormRequest,
  PreviewRunScheduleFormResponse,
  RunScheduleForm,
  SchemaRunScheduleFormRequest,
  SchemaRunScheduleFormResponse,
} from './run-schedule-form';

export interface ZodRunScheduleFormDeps {
  readonly runSchedule: RunSchedule;
}

/**
 * `RunScheduleForm` for Zod form schemas. The time and the type's own fields are checked in one
 * pass, so the user sees every rejected field at once, not the time first and the payload after.
 */
export class ZodRunScheduleForm implements RunScheduleForm {
  constructor(private readonly d: ZodRunScheduleFormDeps) {}

  schema<Request, Values>({
    request,
  }: SchemaRunScheduleFormRequest<Request, Values>): SchemaRunScheduleFormResponse<
    Request,
    Values
  > {
    const schema = z.custom<Values & RunScheduleValues>().transform((values, ctx) => {
      const { run, scheduledAt, ...rest } = values;
      const schedule = { run, scheduledAt };
      const { problem } = this.d.runSchedule.check(schedule);
      if (problem) {
        // The field's message comes from the draft's `fieldMessage`, as for every rejected field.
        ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: problem });
      }
      const sent = problem ? undefined : this.d.runSchedule.toRequest(schedule).scheduledAt;
      const parsed = request.safeParse(sent === undefined ? rest : { ...rest, scheduledAt: sent });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
        }
      }
      return problem || !parsed.success ? z.NEVER : parsed.data;
    });
    return { schema };
  }

  preview<Values>({
    values,
  }: PreviewRunScheduleFormRequest<Values>): PreviewRunScheduleFormResponse<Values> {
    const { run, scheduledAt, ...rest } = values;
    const sent = this.d.runSchedule.toRequest({ run, scheduledAt }).scheduledAt;
    return { values: sent === undefined ? rest : { ...rest, scheduledAt: sent } };
  }
}
