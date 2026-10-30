import { type CreateJobRequest, type Job, JOB_LIMITS } from '@job-queue/contracts';
import type { ReactNode } from 'react';
import { type FieldValues, type Path, useFormContext } from 'react-hook-form';
import { Link } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';
import { ApiError } from '../api/api-error';
import { useCreateJob } from '../hooks/use-create-job';
import type { JobFormDraft } from '../model/job-form-draft';

/** Error type of a message the API sent, shown as it is (not replaced by job-ui's own message). */
const API_ERROR = 'api';

/** What a type's payload fields need from the form: input props and the error of a field. */
export interface JobFormFields<Field extends string> {
  /** Props for the field's input: id, ARIA state and the form registration. */
  input(name: Field): Record<string, unknown>;
  error(name: Field): string | undefined;
}

/**
 * The submit form of any job type (designs "SubmitJob", "SubmitWebhook"): job type, the type's
 * payload fields, execution settings and buttons. Checked with the type's form schema before it
 * is sent; an API `VALIDATION_FAILED` answer is shown on the fields it names.
 */
export function JobForm<Values extends FieldValues, Field extends Path<Values>>({
  draft,
  picker,
  payload,
  onCreated,
}: {
  draft: JobFormDraft<Values, Field>;
  picker: ReactNode;
  payload: (fields: JobFormFields<Field>) => ReactNode;
  onCreated: (job: Job) => void;
}) {
  const form = useFormContext<Values, unknown, CreateJobRequest>();
  const { errors } = form.formState;
  const create = useCreateJob();

  /** The message to show under a field: the API's own, or job-ui's for a schema rejection. */
  const errorOf = (name: Field): string | undefined => {
    const error = form.getFieldState(name, form.formState).error;
    if (!error) return undefined;
    return error.type === API_ERROR
      ? error.message
      : draft.fieldMessage({ field: name, values: form.getValues() }).message;
  };
  const input = (name: Field, options?: { valueAsNumber: true }) => ({
    id: `field-${name}`,
    'aria-invalid': errorOf(name) ? true : undefined,
    'aria-describedby': errorOf(name) ? `field-${name}-error` : undefined,
    ...form.register(name, options),
  });
  const alert =
    errors.root?.api?.message ??
    (create.error &&
    !(create.error instanceof ApiError && create.error.code === 'VALIDATION_FAILED')
      ? create.error.message
      : null);
  // Runs only when the form schema accepts the values.
  const submit = form.handleSubmit((request) => {
    create.mutate(request, {
      onSuccess: onCreated,
      onError: (error) => {
        if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return;
        const mapped = draft.apiErrors({ details: error.details });
        for (const [name, message] of Object.entries(mapped.errors)) {
          form.setError(name as Field, { type: API_ERROR, message: message as string });
        }
        // API issues that match no field, or a rejection with no issues at all: shown in the
        // alert so the user always learns why nothing was created.
        const fieldCount = Object.keys(mapped.errors).length;
        if (mapped.unmatched.length > 0 || fieldCount === 0) {
          const message = mapped.unmatched.length > 0 ? mapped.unmatched.join(' ') : error.message;
          form.setError('root.api', { type: API_ERROR, message });
        }
      },
    });
  });
  // The execution fields are on every form; typed through the draft's own field names.
  const priority = 'priority' as Field;
  const maxAttempts = 'maxAttempts' as Field;

  return (
    <form
      noValidate
      className="flex min-w-0 flex-[999_1_560px] flex-col rounded-xl border border-border bg-card"
      onSubmit={(event) => void submit(event)}
    >
      <Section legend={en.submit.typeSection}>{picker}</Section>
      <Section legend={en.submit.payloadSection}>
        {payload({ input: (name) => input(name), error: errorOf })}
      </Section>
      <Section legend={en.submit.executionSection} last>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          <FormField
            label={en.submit.priority}
            name={priority}
            error={errorOf(priority)}
            hint={en.submit.priorityHint(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max)}
          >
            <Input
              type="number"
              min={JOB_LIMITS.priority.min}
              max={JOB_LIMITS.priority.max}
              className="font-mono"
              {...input(priority, { valueAsNumber: true })}
            />
          </FormField>
          <FormField
            label={en.submit.maxAttempts}
            name={maxAttempts}
            error={errorOf(maxAttempts)}
            hint={en.submit.maxAttemptsHint(JOB_LIMITS.maxAttempts.min, JOB_LIMITS.maxAttempts.max)}
          >
            <Input
              type="number"
              min={JOB_LIMITS.maxAttempts.min}
              max={JOB_LIMITS.maxAttempts.max}
              className="font-mono"
              {...input(maxAttempts, { valueAsNumber: true })}
            />
          </FormField>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{en.submit.run}</span>
          <ComingSoon className="self-start">
            <div
              role="group"
              aria-label={en.submit.runLabel}
              className="flex gap-1 rounded-[9px] bg-secondary p-[3px]"
            >
              <button
                type="button"
                aria-pressed="true"
                className="h-[34px] rounded-[6px] bg-card px-3.5 text-[13px] font-medium shadow-xs"
              >
                {en.submit.runNow}
              </button>
              <button
                type="button"
                aria-pressed="false"
                className="h-[34px] rounded-[6px] px-3.5 text-[13px] font-medium text-muted-foreground"
              >
                {en.submit.runLater}
              </button>
            </div>
          </ComingSoon>
        </div>
        <ComingSoon className="w-full">
          <label className="flex w-full flex-col gap-1.5 text-[13px] font-medium">
            <span>
              {en.submit.idempotencyKey}{' '}
              <span className="font-normal text-muted-foreground">{en.submit.optional}</span>
            </span>
            <span className="flex gap-2">
              <Input type="text" className="font-mono" />
              <Button type="button" variant="outline" className="h-10">
                {en.submit.generate}
              </Button>
            </span>
          </label>
        </ComingSoon>
      </Section>
      <div className="flex flex-col gap-3 rounded-b-xl border-t border-border bg-surface-muted px-6 py-4">
        {alert && (
          <Alert variant="destructive" className="border-destructive-border bg-destructive-muted">
            <AlertDescription>{alert}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button asChild variant="outline" className="h-10 no-underline">
            <Link to="/jobs">{en.submit.cancel}</Link>
          </Button>
          <Button type="submit" className="h-10 px-[18px]" disabled={create.isPending}>
            {create.isPending ? en.submit.submitting : en.submit.submit}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Section({
  legend,
  last = false,
  children,
}: {
  legend: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset
      className={`m-0 flex flex-col gap-4 border-0 p-6 ${last ? '' : 'border-b border-border-soft'}`}
    >
      <legend className="float-left mb-1 p-0 text-[15px] font-semibold">{legend}</legend>
      <div className="clear-both flex flex-col gap-4">{children}</div>
    </fieldset>
  );
}

/** A labelled form field with its error (red, under it) or else its hint. */
export function FormField({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${error ? 'text-destructive' : ''}`}>
      <Label htmlFor={`field-${name}`} className="text-[13px]">
        {label}
      </Label>
      {children}
      {error ? (
        <span id={`field-${name}-error`} className="text-xs">
          {error}
        </span>
      ) : (
        hint && <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
