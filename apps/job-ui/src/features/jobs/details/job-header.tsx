import type { Job } from '@job-queue/contracts';
import type { ReactNode } from 'react';

import { en } from '@/locales';

import { useCurl } from '../hooks/use-curl';
import { useJobPresenter } from '../hooks/use-job-presenter';
import { LiveIndicator } from '../list/live-indicator';
import { StatusBadge } from '../list/status-badge';
import { CancelJobDialog } from './cancel-job-dialog';
import { CopyButton } from './copy-button';
import { DeleteJobDialog } from './delete-job-dialog';
import { RetryJobButton } from './retry-job-button';

/** The full id with status and type badges, and the job's actions (design "JobDetail"). */
export function JobHeader({ job, connectionLost }: { job: Job; connectionLost: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-mono text-[22px] font-medium tracking-tight">{job.id}</h1>
        <JobBadges job={job} />
      </div>
      <JobActions job={job} connectionLost={connectionLost} />
    </div>
  );
}

/** The job's status and type badges, next to a page title. */
export function JobBadges({ job }: { job: Job }) {
  return (
    <>
      <StatusBadge status={job.status} className="h-[26px] px-2.5 text-[13px]" />
      <span className="inline-flex h-[26px] items-center rounded-[6px] bg-secondary px-2.5 font-mono text-xs text-subtle-foreground">
        {en.jobTypes[job.type]}
      </span>
    </>
  );
}

/**
 * The live indicator and the job's actions: Copy as cURL, Cancel, Retry and Delete as its status
 * allows; `children` are a page's own actions, shown before them.
 */
export function JobActions({
  job,
  connectionLost,
  children,
}: {
  job: Job;
  connectionLost: boolean;
  children?: ReactNode;
}) {
  const curl = useCurl();
  const actions = useJobPresenter().actions({ job });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LiveIndicator connectionLost={connectionLost} />
      {children}
      <CopyButton
        text={curl.get({ id: job.id }).command}
        label={en.copy.copyAsCurl}
        className="h-10"
      />
      {actions.cancel && <CancelJobDialog id={job.id} />}
      {actions.retry && <RetryJobButton id={job.id} />}
      {actions.delete && <DeleteJobDialog id={job.id} />}
    </div>
  );
}
