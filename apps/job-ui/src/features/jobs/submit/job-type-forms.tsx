import type { JobType } from '@job-queue/contracts';
import type { ReactNode } from 'react';
import type { FieldValues, Path } from 'react-hook-form';

import { useEmailJobDraft } from '../hooks/use-email-job-draft';
import { useTransitJobDraft } from '../hooks/use-transit-job-draft';
import { useWebhookJobDraft } from '../hooks/use-webhook-job-draft';
import type { JobFormDraft } from '../model/job-form-draft';
import { EmailPayloadFields } from './email-payload-fields';
import type { JobFormFields } from './job-form-sections';
import { TransitPayloadFields } from './transit-payload-fields';
import { WebhookPayloadFields } from './webhook-payload-fields';

/** What a form of one job type is built from: its draft and its "2. Payload" fields. */
export interface JobTypeFormParts<Values extends FieldValues, Field extends Path<Values>> {
  readonly type: JobType;
  readonly draft: JobFormDraft<Values, Field>;
  readonly payload: (fields: JobFormFields<Field>) => ReactNode;
}

/**
 * Renders the form of the chosen job type through `render`, given that type's draft and payload
 * fields. Callers key what they render by `parts.type`, so a switch starts a fresh form.
 */
export function JobTypeForms({
  type,
  render,
}: {
  type: JobType;
  render: <Values extends FieldValues, Field extends Path<Values>>(
    parts: JobTypeFormParts<Values, Field>,
  ) => ReactNode;
}) {
  const emailDraft = useEmailJobDraft();
  const webhookDraft = useWebhookJobDraft();
  const transitDraft = useTransitJobDraft();
  if (type === 'flight-transit') {
    return render({
      type,
      draft: transitDraft,
      payload: (fields) => <TransitPayloadFields fields={fields} />,
    });
  }
  if (type === 'webhook') {
    return render({
      type,
      draft: webhookDraft,
      payload: (fields) => <WebhookPayloadFields fields={fields} />,
    });
  }
  return render({
    type,
    draft: emailDraft,
    payload: (fields) => <EmailPayloadFields fields={fields} />,
  });
}
