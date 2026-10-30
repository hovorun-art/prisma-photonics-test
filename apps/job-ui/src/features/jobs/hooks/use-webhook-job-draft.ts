import { useMemo } from 'react';

import type { JobFormDraft } from '../model/job-form-draft';
import type { WebhookFormField, WebhookFormValues } from '../model/webhook-form-values';
import { ZodWebhookJobDraft } from '../model/zod-webhook-job-draft';
import { useRunSchedule } from './use-run-schedule';

/** The webhook form's `JobFormDraft` the submit page and its form share. */
export function useWebhookJobDraft(): JobFormDraft<WebhookFormValues, WebhookFormField> {
  const runSchedule = useRunSchedule();
  return useMemo(() => new ZodWebhookJobDraft({ runSchedule }), [runSchedule]);
}
