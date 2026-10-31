import { useContext } from 'react';
import { useController, useFormContext } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { useRunSchedule } from '../hooks/use-run-schedule';
import type { JobRun, RunScheduleValues } from '../model/run-schedule';
import { FieldIdPrefixContext } from './field-id-prefix-context';
import { FormField } from './job-form-sections';

const CHOICES: readonly { run: JobRun; label: string }[] = [
  { run: 'now', label: en.submit.runNow },
  { run: 'later', label: en.submit.runLater },
];
const FIELD = 'scheduledAt';

/**
 * "Run" in "3. Execution": Immediately, or At a specific time with a date and time input in the
 * browser's time zone. The time's error comes from the form, like every other field's.
 */
export function RunChoice({
  input,
  error,
}: {
  /** Props for the time input: id, ARIA state and the form registration. */
  input: Record<string, unknown>;
  error: string | undefined;
}) {
  const { control } = useFormContext<RunScheduleValues>();
  const { field } = useController({ control, name: 'run' });
  const { timeZone } = useRunSchedule().timeZone();
  const id = `${useContext(FieldIdPrefixContext)}-${FIELD}`;
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">{en.submit.run}</span>
        <div
          role="group"
          aria-label={en.submit.runLabel}
          className="flex gap-1 self-start rounded-[9px] bg-secondary p-[3px]"
        >
          {CHOICES.map(({ run, label }) => (
            <button
              key={run}
              type="button"
              aria-pressed={field.value === run}
              onClick={() => {
                field.onChange(run);
              }}
              className={cn(
                'h-[34px] rounded-[6px] px-3.5 text-[13px] font-medium',
                field.value === run ? 'bg-card shadow-xs' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {field.value === 'later' && (
        <FormField
          label={en.submit.scheduledAt}
          name={FIELD}
          error={error}
          hint={en.submit.scheduleHint(timeZone)}
        >
          <Input
            type="datetime-local"
            className="self-start font-mono"
            {...input}
            // The hint names the time zone the time is read in, so it describes the input too.
            aria-describedby={error ? `${id}-error` : `${id}-hint`}
          />
        </FormField>
      )}
    </>
  );
}
