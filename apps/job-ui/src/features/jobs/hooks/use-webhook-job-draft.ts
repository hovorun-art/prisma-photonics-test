import { useMemo } from 'react';

import type { JobFormDraft } from '../model/job-form-draft';
import type { WebhookFormField, WebhookFormValues } from '../model/webhook-form-values';
import { ZodWebhookJobDraft } from '../model/zod-webhook-job-draft';

/** The webhook form's `JobFormDraft` the submit page and its form share. */
export function useWebhookJobDraft(): JobFormDraft<WebhookFormValues, WebhookFormField> {
  return useMemo(() => new ZodWebhookJobDraft(), []);
}
