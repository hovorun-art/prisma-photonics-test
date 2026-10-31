import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { en } from '@/locales';

import type { EmailFormField } from '../model/email-form-values';
import { FormField, type JobFormFields } from './job-form-sections';

/** "2. Payload" of an email job (design "SubmitJob"): To, Subject, Body. */
export function EmailPayloadFields({ fields }: { fields: JobFormFields<EmailFormField> }) {
  return (
    <>
      <FormField label={en.submit.to} name="payload.to" error={fields.error('payload.to')}>
        <Input type="email" autoComplete="off" {...fields.input('payload.to')} />
      </FormField>
      <FormField
        label={en.submit.subject}
        name="payload.subject"
        error={fields.error('payload.subject')}
      >
        <Input type="text" {...fields.input('payload.subject')} />
      </FormField>
      <FormField label={en.submit.body} name="payload.body" error={fields.error('payload.body')}>
        <Textarea rows={6} {...fields.input('payload.body')} />
      </FormField>
      <p className="m-0 text-[13px] text-muted-foreground">{en.submit.emailHint}</p>
    </>
  );
}
