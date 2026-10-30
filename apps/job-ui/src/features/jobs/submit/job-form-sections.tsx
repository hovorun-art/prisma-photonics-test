import { JOB_LIMITS } from '@job-queue/contracts';
import { type ReactNode, useContext } from 'react';
import { type FieldValues, type Path, useFormContext } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';
import type { JobFormDraft } from '../model/job-form-draft';
import { FieldIdPrefixContext } from './field-id-prefix-context';

/** Error type of a message the API sent, shown as it is (not replaced by job-ui's own message). */
export const API_ERROR = 'api';

/** What a type's payload fields need from the form: input props and the error of a field. */
export interface JobFormFields<Field extends string> {
  /** The element id of the field's input. */
  id(name: Field): string;
  /** Props for the field's input: id, ARIA state and the form registration. */
  input(name: Field): Record<string, unknown>;
  error(name: Field): string | undefined;
}

/**
 * The three sections of a job's form (job type, the type's payload fields, execution settings),
 * on the form of the surrounding `FormProvider`. A field's message is the API's own when the API
 * rejected it (error type `API_ERROR`), else the draft's message for a schema rejection.
 */
export function JobFormSections<Values extends FieldValues, Field extends Path<Values>>({
  draft,
  picker,
  payload,
}: {
  draft: JobFormDraft<Values, Field>;
  picker: ReactNode;
  payload: (fields: JobFormFields<Field>) => ReactNode;
}) {
  const form = useFormContext<Values>();
  const idPrefix = useContext(FieldIdPrefixContext);
  const id = (name: Field) => `${idPrefix}-${name}`;

  const errorOf = (name: Field): string | undefined => {
    const error = form.getFieldState(name, form.formState).error;
    if (!error) return undefined;
    return error.type === API_ERROR
      ? error.message
      : draft.fieldMessage({ field: name, values: form.getValues() }).message;
  };
  const input = (name: Field, options?: { valueAsNumber: true }) => ({
    id: id(name),
    'aria-invalid': errorOf(name) ? true : undefined,
    'aria-describedby': errorOf(name) ? `${id(name)}-error` : undefined,
    ...form.register(name, options),
  });
  // The execution fields are on every form; typed through the draft's own field names.
  const priority = 'priority' as Field;
  const maxAttempts = 'maxAttempts' as Field;

  return (
    <>
      <Section legend={en.submit.typeSection}>{picker}</Section>
      <Section legend={en.submit.payloadSection}>
        {payload({ id, input: (name) => input(name), error: errorOf })}
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
    </>
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
  const id = `${useContext(FieldIdPrefixContext)}-${name}`;
  return (
    <div className={`flex flex-col gap-1.5 ${error ? 'text-destructive' : ''}`}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
      {error ? (
        <span id={`${id}-error`} className="text-xs">
          {error}
        </span>
      ) : (
        hint && <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
