import { zodResolver } from '@hookform/resolvers/zod';
import { CreateEmailJobRequest, type CreateJobRequest } from '@job-queue/contracts';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';

import { en } from '@/locales';

import { EMPTY_EMAIL_FORM, type EmailFormValues } from '../model/email-form-values';
import { EmailJobForm } from './email-job-form';
import { RequestPreview } from './request-preview';

/** Submit an email job (design "SubmitJob"); after success the new job's page opens. */
export function SubmitJobPage() {
  const navigate = useNavigate();
  // Checked with the shared contract schema, the same one job-service validates with.
  const form = useForm<EmailFormValues, unknown, CreateJobRequest>({
    defaultValues: EMPTY_EMAIL_FORM,
    resolver: zodResolver(CreateEmailJobRequest),
  });
  const request = useWatch({ control: form.control }) as EmailFormValues;
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
        <FormProvider {...form}>
          <EmailJobForm
            onCreated={(job) => {
              void navigate(`/jobs/${job.id}`);
            }}
          />
        </FormProvider>
        <RequestPreview request={request} />
      </div>
    </>
  );
}
