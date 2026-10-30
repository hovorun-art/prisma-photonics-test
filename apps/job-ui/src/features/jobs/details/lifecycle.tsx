import type { Job } from '@job-queue/contracts';
import { Check, X } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { useJobPresenter } from '../hooks/use-job-presenter';

/** The steps the job has gone through, with their times (design "JobDetail"). */
export function Lifecycle({ job }: { job: Job }) {
  const { steps } = useJobPresenter().lifecycle({ job });
  return (
    <Card role="region" aria-label={en.job.lifecycle} className="gap-3 px-5 py-4 shadow-none">
      <h2 className="m-0 text-[15px] font-semibold">{en.job.lifecycle}</h2>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {steps.map((step) => {
          const bad = step.reached && (step.status === 'failed' || step.status === 'cancelled');
          return (
            <li
              key={step.status}
              data-reached={step.reached}
              className={cn(
                'flex items-center gap-2.5',
                !step.reached && 'text-muted-foreground',
                bad && 'font-semibold text-destructive',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-[18px] items-center justify-center rounded-full',
                  step.reached
                    ? 'bg-primary text-primary-foreground'
                    : 'border-[1.5px] border-dashed border-input',
                  bad && 'bg-destructive',
                )}
              >
                {step.reached &&
                  (bad ? <X className="size-2.5" /> : <Check className="size-2.5" />)}
              </span>
              <span>{en.statuses[step.status]}</span>
              {step.at && <span className="ml-auto font-mono text-xs font-normal">{step.at}</span>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
