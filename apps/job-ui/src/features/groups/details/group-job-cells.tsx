import type { Job } from '@job-queue/contracts';
import { Link } from 'react-router';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { en } from '@/locales';

import { useJobPresenter } from '../../jobs/hooks/use-job-presenter';
import { GroupProgressImpl } from '../model/group-progress.impl';
import { CELL_COLOUR } from './cell-style';

const progress = new GroupProgressImpl();

/**
 * One cell per job of the group in the order given (oldest first), 25 to a row (design
 * "BatchJob"); a cell shows the job's short id and status on hover and focus and opens its page.
 */
export function GroupJobCells({ jobs }: { jobs: readonly Job[] }) {
  if (jobs.length === 0) {
    return <p className="m-0 text-[13px] text-muted-foreground">{en.group.noJobs}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">{en.group.jobsRange(jobs.length)}</div>
      <TooltipProvider>
        <div className="grid grid-cols-[repeat(25,minmax(0,1fr))] gap-[3px]">
          {jobs.map((job) => (
            <JobCell key={job.id} job={job} />
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}

function JobCell({ job }: { job: Job }) {
  const presenter = useJobPresenter();
  const { kind } = progress.cell({ status: job.status });
  const label = en.group.cell(presenter.shortId({ id: job.id }).text, en.statuses[job.status]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={`/jobs/${job.id}`}
          aria-label={label}
          data-kind={kind}
          className={`aspect-square rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring ${CELL_COLOUR[kind]}`}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
