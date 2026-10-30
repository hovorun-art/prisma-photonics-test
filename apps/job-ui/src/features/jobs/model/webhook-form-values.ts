import type { WEBHOOK_METHODS } from '@job-queue/contracts';

/**
 * What the webhook form holds: the request it sends, except that the body is the text the user
 * typed (parsed to a JSON object when the form is checked). Field names are request paths.
 */
export interface WebhookFormValues {
  type: 'webhook';
  payload: { method: (typeof WEBHOOK_METHODS)[number]; url: string; body: string };
  priority?: number;
  maxAttempts?: number;
}

export const WEBHOOK_FORM_FIELDS = [
  'payload.method',
  'payload.url',
  'payload.body',
  'priority',
  'maxAttempts',
] as const;
export type WebhookFormField = (typeof WEBHOOK_FORM_FIELDS)[number];
