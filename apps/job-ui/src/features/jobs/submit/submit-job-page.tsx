import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { en } from '@/locales';

import type { CreateEmailJobRequest } from '@job-queue/contracts';
import type { z } from 'zod';

import { EMPTY_EMAIL_FORM, type EmailFormValues } from './email-form-values';
import { EmailJobForm } from './email-job-form';
import { RequestPreview } from './request-preview';

/** The request the form's values make; the preview shows it and the API receives it. */
function toEmailRequest(values: EmailFormValues): z.input<typeof CreateEmailJobRequest> {
  return {
    type: 'email',
    payload: { to: values.to, subject: values.subject, body: values.body },
    priority: Number(values.priority),
    maxAttempts: Number(values.maxAttempts),
  };
}

/** Submit an email job (design "SubmitJob"); after success the new job's page opens. */
export function SubmitJobPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY_EMAIL_FORM);
  const request = toEmailRequest(values);
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
        <EmailJobForm
          values={values}
          request={request}
          onChange={setValues}
          onCreated={(job) => {
            void navigate(`/jobs/${job.id}`);
          }}
        />
        <RequestPreview request={request} />
      </div>
    </>
  );
}
