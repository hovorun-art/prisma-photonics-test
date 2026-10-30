import { zodResolver } from '@hookform/resolvers/zod';
import { type CreateJobRequest, JOB_LIMITS, type Job, type JobType } from '@job-queue/contracts';
import { type ReactNode, useEffect, useState } from 'react';
import {
  type DefaultValues,
  type FieldValues,
  FormProvider,
  type Path,
  useForm,
  useWatch,
} from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { en } from '@/locales';

import { useEmailJobDraft } from '../hooks/use-email-job-draft';
import { useTransitJobDraft } from '../hooks/use-transit-job-draft';
import { useWebhookJobDraft } from '../hooks/use-webhook-job-draft';
import type { JobFormDraft, JobFormExecution } from '../model/job-form-draft';
import { EmailPayloadFields } from './email-payload-fields';
import { JobForm, type JobFormFields } from './job-form';
import { JobTypePicker } from './job-type-picker';
import { RequestPreview } from './request-preview';
import { TransitPayloadFields } from './transit-payload-fields';
import { WebhookPayloadFields } from './webhook-payload-fields';

const DEFAULT_EXECUTION: JobFormExecution = {
  priority: JOB_LIMITS.priority.default,
  maxAttempts: JOB_LIMITS.maxAttempts.default,
  run: 'now',
  scheduledAt: '',
};
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
  // Priority, max attempts and the run choice, kept in step with the form, so they carry over to the next type
  // whether the user switches with a card or with Back and Forward.
  const [execution, setExecution] = useState(DEFAULT_EXECUTION);
  const emailDraft = useEmailJobDraft();
  const webhookDraft = useWebhookJobDraft();
  const transitDraft = useTransitJobDraft();

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
        {type === 'flight-transit' && (
          <TypedSubmit
            key="flight-transit"
            type="flight-transit"
            draft={transitDraft}
            execution={execution}
            payload={(fields) => <TransitPayloadFields fields={fields} />}
            onExecutionChange={setExecution}
            onChoose={choose}
            onCreated={onCreated}
          />
        )}
        {type === 'webhook' && (
          <TypedSubmit
            key="webhook"
            type="webhook"
            draft={webhookDraft}
            execution={execution}
            payload={(fields) => <WebhookPayloadFields fields={fields} />}
            onExecutionChange={setExecution}
            onChoose={choose}
            onCreated={onCreated}
          />
        )}
        {type === 'email' && (
          <TypedSubmit
            key="email"
            type="email"
            draft={emailDraft}
            execution={execution}
            payload={(fields) => <EmailPayloadFields fields={fields} />}
            onExecutionChange={setExecution}
            onChoose={choose}
            onCreated={onCreated}
          />
        )}
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
  // Checked with the type's form schema, built from the contract job-service validates with.
  const [resolver] = useState(() =>
    zodResolver<Values, unknown, CreateJobRequest>(draft.schema().schema),
  );
  const form = useForm<Values, unknown, CreateJobRequest>({
    defaultValues: draft.emptyValues({ execution }).values as DefaultValues<Values>,
    resolver,
  });
  const values = useWatch({ control: form.control }) as Values;
  useEffect(
    () =>
      form.subscribe({
        formState: { values: true },
        callback: ({ values: current }) => {
          const { priority, maxAttempts, run, scheduledAt } = current as Partial<JobFormExecution>;
          onExecutionChange({
            priority: priority ?? DEFAULT_EXECUTION.priority,
            maxAttempts: maxAttempts ?? DEFAULT_EXECUTION.maxAttempts,
            run: run ?? DEFAULT_EXECUTION.run,
            scheduledAt: scheduledAt ?? DEFAULT_EXECUTION.scheduledAt,
          });
        },
      }),
    [form, onExecutionChange],
  );
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
