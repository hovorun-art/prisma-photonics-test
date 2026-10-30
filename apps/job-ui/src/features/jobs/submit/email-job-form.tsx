import { CreateEmailJobRequest, EMAIL_LIMITS, type Job, JOB_LIMITS } from '@job-queue/contracts';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';
import { ApiError } from '../api/api-error';
import { useCreateJob } from '../hooks/use-create-job';
import type { EmailFormField, EmailFormValues } from './email-form-values';
import { JobTypePicker } from './job-type-picker';

type FieldErrors = Partial<Record<EmailFormField, string>>;
type EmailRequest = z.input<typeof CreateEmailJobRequest>;

/** Contract paths of the request (`payload.to`) to the form's fields. */
const FIELD_OF_PATH: Readonly<Record<string, EmailFormField>> = {
  'payload.to': 'to',
  'payload.subject': 'subject',
  'payload.body': 'body',
  priority: 'priority',
  maxAttempts: 'maxAttempts',
};

/** The email form (design "SubmitJob"): checked with the shared schema before it is sent. */
export function EmailJobForm({
  values,
  request,
  onChange,
  onCreated,
}: {
  values: EmailFormValues;
  /** The request `values` make; the same object the preview shows. */
  request: EmailRequest;
  onChange: (values: EmailFormValues) => void;
  onCreated: (job: Job) => void;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const create = useCreateJob();
  const otherError =
    create.error && !(create.error instanceof ApiError && create.error.code === 'VALIDATION_FAILED')
      ? create.error.message
      : null;

  const field = (name: EmailFormField) => ({
    id: `field-${name}`,
    value: values[name],
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `field-${name}-error` : undefined,
    onChange: (event: { target: { value: string } }) => {
      onChange({ ...values, [name]: event.target.value });
    },
  });

  return (
    <form
      noValidate
      className="flex min-w-0 flex-[999_1_560px] flex-col rounded-xl border border-border bg-card"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = CreateEmailJobRequest.safeParse(request);
        if (!parsed.success) {
          setErrors(clientErrors(parsed.error.issues, values));
          return;
        }
        setErrors({});
        create.mutate(parsed.data, {
          onSuccess: onCreated,
          onError: (error) => {
            if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
              setErrors(apiErrors(error.details));
            }
          },
        });
      }}
    >
      <Section legend={en.submit.typeSection}>
        <JobTypePicker />
      </Section>
      <Section legend={en.submit.payloadSection}>
        <Field label={en.submit.to} name="to" error={errors.to}>
          <Input type="email" autoComplete="off" {...field('to')} />
        </Field>
        <Field label={en.submit.subject} name="subject" error={errors.subject}>
          <Input type="text" {...field('subject')} />
        </Field>
        <Field label={en.submit.body} name="body" error={errors.body}>
          <Textarea rows={6} {...field('body')} />
        </Field>
        <p className="m-0 text-[13px] text-muted-foreground">{en.submit.emailHint}</p>
      </Section>
      <Section legend={en.submit.executionSection} last>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          <Field
            label={en.submit.priority}
            name="priority"
            error={errors.priority}
            hint={en.submit.priorityHint(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max)}
          >
            <Input
              type="number"
              min={JOB_LIMITS.priority.min}
              max={JOB_LIMITS.priority.max}
              className="font-mono"
              {...field('priority')}
            />
          </Field>
          <Field
            label={en.submit.maxAttempts}
            name="maxAttempts"
            error={errors.maxAttempts}
            hint={en.submit.maxAttemptsHint(JOB_LIMITS.maxAttempts.min, JOB_LIMITS.maxAttempts.max)}
          >
            <Input
              type="number"
              min={JOB_LIMITS.maxAttempts.min}
              max={JOB_LIMITS.maxAttempts.max}
              className="font-mono"
              {...field('maxAttempts')}
            />
          </Field>
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
        {otherError && (
          <Alert variant="destructive" className="border-destructive-border bg-destructive-muted">
            <AlertDescription>{otherError}</AlertDescription>
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

function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: EmailFormField;
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

/** Our own messages for what the shared schema rejected, one per field. */
function clientErrors(issues: readonly z.core.$ZodIssue[], values: EmailFormValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const name = FIELD_OF_PATH[issue.path.join('.')];
    if (!name || errors[name]) continue;
    errors[name] = messageFor(name, values);
  }
  return errors;
}

function messageFor(name: EmailFormField, values: EmailFormValues): string {
  switch (name) {
    case 'to':
      return en.submit.errors.to;
    case 'subject':
      return values.subject === ''
        ? en.submit.errors.subjectRequired
        : en.submit.errors.subjectTooLong(EMAIL_LIMITS.subjectMaxLength);
    case 'body':
      return en.submit.errors.bodyTooLong(EMAIL_LIMITS.bodyMaxLength);
    case 'priority':
      return en.submit.errors.priority(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max);
    case 'maxAttempts':
      return en.submit.errors.maxAttempts(JOB_LIMITS.maxAttempts.min, JOB_LIMITS.maxAttempts.max);
  }
}

/** The API's `VALIDATION_FAILED` issues (`details.issues`), with their own messages, per field. */
function apiErrors(details: Readonly<Record<string, unknown>>): FieldErrors {
  const errors: FieldErrors = {};
  const issues = Array.isArray(details.issues) ? (details.issues as unknown[]) : [];
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (!Array.isArray(path) || typeof message !== 'string') continue;
    const name = FIELD_OF_PATH[path.join('.')];
    if (name && !errors[name]) errors[name] = message;
  }
  return errors;
}
