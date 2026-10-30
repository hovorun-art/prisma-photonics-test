import type { Job, JobGroup } from '@job-queue/contracts';

import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import type { CellKind } from '../model/group-progress';
import { GroupProgressImpl } from '../model/group-progress.impl';
import { CELL_COLOUR } from './cell-style';
import { GroupJobCells } from './group-job-cells';

const progress = new GroupProgressImpl();

/**
 * The group's progress (design "BatchJob"): the share of finished jobs, a bar, the Completed,
 * Failed and Remaining counts, and one cell per job once the jobs have loaded ("Could not load
 * the jobs" while their first request has failed).
 */
export function GroupProgressCard({
  group,
  jobs,
  jobsFailed,
}: {
  group: JobGroup;
  jobs: readonly Job[] | undefined;
  /** The jobs have not loaded yet and the last request for them failed. */
  jobsFailed: boolean;
}) {
  const { finished, percent, remaining } = progress.summary({ group });
  const tiles: [CellKind, string, number][] = [
    ['completed', en.group.counts.completed, group.completed],
    ['failed', en.group.counts.failed, group.failed],
    ['remaining', en.group.counts.remaining, remaining],
  ];
  return (
    <Card
      role="region"
      aria-label={en.group.progress}
      className="gap-[18px] rounded-xl p-6 shadow-none"
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[44px] leading-none font-medium tracking-[-0.03em]">
          {en.group.percent(percent)}
        </span>
        <span className="text-muted-foreground">{en.group.finishedOf(finished, group.total)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={en.group.progressBar}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-[4px] bg-status-processing-bg"
      >
        <div className="h-2 rounded-[4px] bg-status-processing" style={{ width: `${percent}%` }} />
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3">
        {tiles.map(([kind, label, value]) => (
          <div
            key={kind}
            className="flex flex-col gap-0.5 rounded-[10px] bg-background px-3.5 py-3"
          >
            <dt className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className={`size-2 rounded-[2px] ${CELL_COLOUR[kind]}`} aria-hidden="true" />
              {label}
            </dt>
            <dd className="m-0 font-mono text-xl font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {jobs ? (
        <GroupJobCells jobs={jobs} />
      ) : (
        jobsFailed && <p className="m-0 text-[13px] text-muted-foreground">{en.group.jobsFailed}</p>
      )}
    </Card>
  );
}
