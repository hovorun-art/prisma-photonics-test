import type { Job } from '@job-queue/contracts';
import { RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { en } from '@/locales';

import { ComingSoon } from '../../app-frame/coming-soon';
import { useCurl } from '../hooks/use-curl';
import { useJobPresenter } from '../hooks/use-job-presenter';
import { LiveIndicator } from '../list/live-indicator';
import { StatusBadge } from '../list/status-badge';
import { CopyButton } from './copy-button';
import { DeleteJobDialog } from './delete-job-dialog';

/** The full id with status and type badges, and the job's actions (design "JobDetail"). */
export function JobHeader({ job, connectionLost }: { job: Job; connectionLost: boolean }) {
  const curl = useCurl();
  const actions = useJobPresenter().actions({ job });
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-mono text-[22px] font-medium tracking-tight">{job.id}</h1>
        <StatusBadge status={job.status} className="h-[26px] px-2.5 text-[13px]" />
        <span className="inline-flex h-[26px] items-center rounded-[6px] bg-secondary px-2.5 font-mono text-xs text-subtle-foreground">
          {en.jobTypes[job.type]}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LiveIndicator connectionLost={connectionLost} />
        <CopyButton
          text={curl.get({ id: job.id }).command}
          label={en.copy.copyAsCurl}
          className="h-10"
        />
        {actions.cancel && (
          <ComingSoon>
            <Button variant="outline" className="h-10">
              {en.job.cancelJob}
            </Button>
          </ComingSoon>
        )}
        {actions.retry && (
          <ComingSoon>
            <Button className="h-10">
              <RotateCw aria-hidden="true" />
              {en.job.retryJob}
            </Button>
          </ComingSoon>
        )}
        {actions.delete && <DeleteJobDialog id={job.id} />}
      </div>
    </div>
  );
}
