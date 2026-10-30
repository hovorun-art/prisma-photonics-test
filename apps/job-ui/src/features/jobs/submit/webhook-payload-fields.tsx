import { WEBHOOK_METHODS } from '@job-queue/contracts';
import { CircleAlert } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import type { WebhookFormField } from '../model/webhook-form-values';
import { FormField, type JobFormFields } from './job-form';

/**
 * "2. Payload" of a webhook job (design "SubmitWebhook"): Method and URL on one row, the JSON
 * body in a monospace text area, and a note that the mock target fails at random.
 */
export function WebhookPayloadFields({ fields }: { fields: JobFormFields<WebhookFormField> }) {
  return (
    <>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
        <FormField
          label={en.submit.method}
          name="payload.method"
          error={fields.error('payload.method')}
        >
          <select
            className={cn(
              'h-9 w-full rounded-md border border-input bg-card px-2.5 text-base shadow-xs outline-none md:text-sm',
              'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
              'aria-invalid:border-destructive',
            )}
            {...fields.input('payload.method')}
          >
            {WEBHOOK_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={en.submit.url} name="payload.url" error={fields.error('payload.url')}>
          <Input type="url" autoComplete="off" {...fields.input('payload.url')} />
        </FormField>
      </div>
      <FormField
        label={en.submit.jsonBody}
        name="payload.body"
        error={fields.error('payload.body')}
      >
        <Textarea rows={5} className="font-mono text-[13px]" {...fields.input('payload.body')} />
      </FormField>
      <p className="m-0 flex items-start gap-2 rounded-md bg-status-pending-bg px-3 py-2.5 text-[13px] text-status-pending">
        <CircleAlert aria-hidden="true" className="mt-px size-4 flex-none" />
        {en.submit.webhookHint}
      </p>
    </>
  );
}
