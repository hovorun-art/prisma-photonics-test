import type { CreateJobRequest, Job } from '@job-queue/contracts';
import { type ReactNode, useState } from 'react';
import { type FieldValues, type Path, useFormContext } from 'react-hook-form';
import { Link } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { en } from '@/locales';

import { ApiError } from '../api/api-error';
import { useApiIssues } from '../hooks/use-api-issues';
import { useCreateJob } from '../hooks/use-create-job';
import { ApiRejectionAlert } from '../model/api-rejection-alert';
import type { JobFormDraft } from '../model/job-form-draft';
import { API_ERROR, type JobFormFields, JobFormSections } from './job-form-sections';

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
  const applyIssues = useApiIssues({ form, draft });
  const [rejection] = useState(() => new ApiRejectionAlert());

  const alert = errors.root?.api?.message ?? null;
  // Runs only when the form schema accepts the values.
  const submit = form.handleSubmit((request) => {
    create.mutate(request, {
      onSuccess: onCreated,
      onError: (error) => {
        const shown =
          error instanceof ApiError && error.code === 'VALIDATION_FAILED'
            ? applyIssues({ details: error.details })
            : { fieldCount: 0, unmatched: [] };
        const { message } = rejection.message({ error, ...shown });
        if (message) form.setError('root.api', { type: API_ERROR, message });
      },
    });
  });
  return (
    <form
      noValidate
      className="flex min-w-0 flex-[999_1_560px] flex-col rounded-xl border border-border bg-card"
      onSubmit={(event) => void submit(event)}
    >
      <JobFormSections draft={draft} picker={picker} payload={payload} />
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
