import { CreateFlightTransitJobRequest } from '@job-queue/contracts';
import type { Clock } from '@job-queue/kernel';
import { z } from 'zod';

import { en } from '@/locales';

import { LocaleExecutionFieldMessages } from './execution-field-messages';
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
import {
  TRANSIT_FORM_FIELDS,
  type TransitFormField,
  type TransitFormValues,
} from './transit-form-values';
import { ValidationIssueMapper } from './validation-issue-mapper';

export interface ZodTransitJobDraftDeps {
  readonly clock: Clock;
}

/** Length of an ISO calendar date, `YYYY-MM-DD`. */
const ISO_DATE_LENGTH = 10;

/**
 * The flight transit job's submit form for the shared Zod schemas, with the strings from
 * `locales/en.ts`. Like job-service, it accepts a departure day while that day is not over in UTC.
 */
export class ZodTransitJobDraft implements JobFormDraft<TransitFormValues, TransitFormField> {
  readonly fields = TRANSIT_FORM_FIELDS;
  private readonly execution = new LocaleExecutionFieldMessages();
  private readonly issues = new ValidationIssueMapper({ fields: TRANSIT_FORM_FIELDS });
  /** Values whose departure date is a real calendar date, whatever else is wrong with them. */
  private readonly withDate = z.object({ payload: z.object({ departureDate: z.iso.date() }) });
  private readonly form = this.formSchema();

  constructor(private readonly d: ZodTransitJobDraftDeps) {}

  emptyValues({
    execution,
  }: EmptyValuesJobFormDraftRequest): EmptyValuesJobFormDraftResponse<TransitFormValues> {
    return {
      values: {
        type: 'flight-transit',
        payload: { origin: '', destination: '', departureDate: this.today() },
        ...execution,
      },
    };
  }

  schema(): SchemaJobFormDraftResponse<TransitFormValues> {
    return { schema: this.form };
  }

  fieldMessage({
    field,
    values,
  }: FieldMessageJobFormDraftRequest<
    TransitFormValues,
    TransitFormField
  >): FieldMessageJobFormDraftResponse {
    const { payload } = values;
    switch (field) {
      case 'payload.origin':
        return { message: en.submit.errors.originRequired };
      case 'payload.destination':
        return {
          message:
            payload.destination === ''
              ? en.submit.errors.destinationRequired
              : en.submit.errors.sameAirport,
        };
      case 'payload.departureDate':
        return {
          message: this.isDate(payload.departureDate)
            ? en.submit.errors.departureDatePast(this.today())
            : en.submit.errors.departureDate,
        };
      case 'priority':
      case 'maxAttempts':
        return this.execution.message({ field });
    }
  }

  apiErrors(req: ApiErrorsJobFormDraftRequest): ApiErrorsJobFormDraftResponse<TransitFormField> {
    return this.issues.map(req);
  }

  previewRequest({
    values,
  }: PreviewRequestJobFormDraftRequest<TransitFormValues>): PreviewRequestJobFormDraftResponse {
    return { request: values };
  }

  /** The contract's transit request, plus the "day not over yet" rule job-service applies. */
  private formSchema(): z.ZodType<
    z.output<typeof CreateFlightTransitJobRequest>,
    TransitFormValues
  > {
    // Runs whenever the date itself is a real date, even if an airport is still missing, so the
    // user sees every invalid field at once.
    return CreateFlightTransitJobRequest.superRefine(
      (request, ctx) => {
        const today = this.today();
        if (request.payload.departureDate < today) {
          ctx.addIssue({
            code: 'custom',
            path: ['payload', 'departureDate'],
            message: en.submit.errors.departureDatePast(today),
          });
        }
      },
      { when: ({ value }) => this.withDate.safeParse(value).success },
    );
  }

  /** Whether the text is a real calendar date, `YYYY-MM-DD`. */
  private isDate(text: string): boolean {
    return z.iso.date().safeParse(text).success;
  }

  /** Today's calendar date in UTC, `YYYY-MM-DD`. */
  private today(): string {
    return this.d.clock.now().now.toISOString().slice(0, ISO_DATE_LENGTH);
  }
}
