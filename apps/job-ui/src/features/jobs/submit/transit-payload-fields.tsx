import { Controller, useFormContext } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import { en } from '@/locales';

import type { TransitFormField, TransitFormValues } from '../model/transit-form-values';
import { AirportCombobox } from './airport-combobox';
import { FormField, type JobFormFields } from './job-form';

/**
 * "2. Payload" of a flight transit job (design "SubmitTransit"): origin and destination picked
 * from the bundled airports and the departure date on one row, and a note on what the worker does.
 */
export function TransitPayloadFields({ fields }: { fields: JobFormFields<TransitFormField> }) {
  const { control, formState } = useFormContext<TransitFormValues>();
  // The form starts at today's UTC date, the earliest day the API accepts.
  const today = formState.defaultValues?.payload?.departureDate;
  const airport = (name: 'payload.origin' | 'payload.destination', label: string) => (
    <FormField label={label} name={name} error={fields.error(name)}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <AirportCombobox
            id={`field-${name}`}
            value={field.value}
            onChange={field.onChange}
            invalid={fields.error(name) !== undefined}
            describedBy={fields.error(name) ? `field-${name}-error` : undefined}
          />
        )}
      />
    </FormField>
  );
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {airport('payload.origin', en.submit.origin)}
        {airport('payload.destination', en.submit.destination)}
        <FormField
          label={en.submit.departureDate}
          name="payload.departureDate"
          error={fields.error('payload.departureDate')}
        >
          <Input type="date" min={today} {...fields.input('payload.departureDate')} />
        </FormField>
      </div>
      <p className="m-0 text-[13px] text-muted-foreground">{en.submit.transitHint}</p>
    </>
  );
}
