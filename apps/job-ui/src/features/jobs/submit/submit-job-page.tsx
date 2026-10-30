import type { Job, JobType } from '@job-queue/contracts';
import { type ReactNode, useState } from 'react';
import { type FieldValues, FormProvider, type Path, useWatch } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { en } from '@/locales';

import { useTypedJobForm } from '../hooks/use-typed-job-form';
import { DEFAULT_JOB_FORM_EXECUTION } from '../model/default-job-form-execution';
import type { JobFormDraft, JobFormExecution } from '../model/job-form-draft';
import { JobForm } from './job-form';
import type { JobFormFields } from './job-form-sections';
import { JobTypeForms } from './job-type-forms';
import { JobTypePicker } from './job-type-picker';
import { RequestPreview } from './request-preview';

/** The query parameter that holds the chosen job type; without it the page shows Email. */
const TYPE_PARAM = 'type';
/** The types the page can show besides Email, by their `type` query value. */
const OTHER_TYPES: readonly JobType[] = ['webhook', 'flight-transit'];

/**
 * Submit a job (designs "SubmitJob", "SubmitWebhook", "SubmitTransit"); the type is in the URL
 * (`/jobs/new?type=webhook`), and after success the new job's page opens.
 */
export function SubmitJobPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type: JobType = OTHER_TYPES.find((other) => other === params.get(TYPE_PARAM)) ?? 'email';
  // Priority and max attempts, kept in step with the form, so they carry over to the next type
  // whether the user switches with a card or with Back and Forward.
  const [execution, setExecution] = useState(DEFAULT_JOB_FORM_EXECUTION);

  const choose = (next: JobType) => {
    if (next === type) return;
    setParams(next === 'email' ? {} : { [TYPE_PARAM]: next });
  };
  const onCreated = (job: Job) => {
    void navigate(`/jobs/${job.id}`);
  };

  return (
    <>
      <nav aria-label={en.job.breadcrumb} className="flex gap-2 text-[13px] text-muted-foreground">
        <Link to="/jobs" className="text-muted-foreground">
          {en.job.jobs}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">{en.submit.breadcrumbNew}</span>
      </nav>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">{en.submit.title}</h1>
        <p className="m-0 text-muted-foreground">{en.submit.subtitle}</p>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        {/* Keyed by type: a switch starts a fresh form, so the payload fields start empty. */}
        <JobTypeForms
          type={type}
          render={(parts) => (
            <TypedSubmit
              key={parts.type}
              {...parts}
              execution={execution}
              onExecutionChange={setExecution}
              onChoose={choose}
              onCreated={onCreated}
            />
          )}
        />
      </div>
    </>
  );
}

/** The form of one job type and the preview of the request it will send. */
function TypedSubmit<Values extends FieldValues, Field extends Path<Values>>({
  type,
  draft,
  execution,
  payload,
  onExecutionChange,
  onChoose,
  onCreated,
}: {
  type: JobType;
  draft: JobFormDraft<Values, Field>;
  execution: JobFormExecution;
  payload: (fields: JobFormFields<Field>) => ReactNode;
  onExecutionChange: (execution: JobFormExecution) => void;
  onChoose: (type: JobType) => void;
  onCreated: (job: Job) => void;
}) {
  const form = useTypedJobForm({ draft, execution, onExecutionChange });
  const values = useWatch({ control: form.control }) as Values;
  const picker = <JobTypePicker selected={type} onSelect={onChoose} />;
  return (
    <>
      <FormProvider {...form}>
        <JobForm draft={draft} picker={picker} payload={payload} onCreated={onCreated} />
      </FormProvider>
      <RequestPreview request={draft.previewRequest({ values }).request} />
    </>
  );
}
