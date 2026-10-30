import type { JobLogEntry, JobLogLevel } from '@job-queue/contracts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { useJobLog } from '../hooks/use-job-log';
import { useJobPresenter } from '../hooks/use-job-presenter';

const LEVEL_STYLE: Readonly<Record<JobLogLevel, string>> = {
  info: 'text-status-processing bg-status-processing-bg',
  warning: 'text-status-pending bg-status-pending-bg',
  error: 'text-status-failed bg-status-failed-bg',
};

const LEVEL_CHOICES: readonly (JobLogLevel | undefined)[] = [undefined, 'info', 'warning', 'error'];

/** One job's log (design "JobLog"): level filter, rows oldest first, refreshed by polling. */
export function JobLogCard({ jobId }: { jobId: string }) {
  const [level, setLevel] = useState<JobLogLevel | undefined>(undefined);
  const log = useJobLog({ id: jobId, level });
  return (
    <Card role="region" aria-label={en.log.title} className="gap-3 px-5 py-4 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold">{en.log.title}</h2>
        <div role="group" aria-label={en.log.filterByLevel} className="flex gap-1.5">
          {LEVEL_CHOICES.map((choice) => (
            <Button
              key={choice ?? 'all'}
              type="button"
              size="xs"
              variant={choice === level ? 'default' : 'outline'}
              aria-pressed={choice === level}
              onClick={() => {
                setLevel(choice);
              }}
            >
              {en.log.levels[choice ?? 'all']}
            </Button>
          ))}
        </div>
      </div>
      {log.isLoading ? (
        <div aria-label={en.log.loading} aria-busy="true" className="flex flex-col gap-2">
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
          <Skeleton className="h-6" />
        </div>
      ) : log.unavailable ? (
        <p className="m-0 text-[13px] text-muted-foreground">{en.log.unavailable}</p>
      ) : log.entries.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          {level === undefined ? en.log.empty : en.log.emptyLevel[level]}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {log.entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function LogRow({ entry }: { entry: JobLogEntry }) {
  const [open, setOpen] = useState(false);
  const time = useJobPresenter().listTime({ at: entry.timestamp }).text;
  const hasMetadata = Object.keys(entry.metadata).length > 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="flex flex-col gap-1 border-t border-border-soft py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="font-mono text-xs text-muted-foreground">{time}</span>
        <Badge className={cn('h-5 rounded-full border-0', LEVEL_STYLE[entry.level])}>
          {en.log.levels[entry.level]}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {entry.attempt === null ? en.log.noAttempt : en.log.attempt(entry.attempt)}
        </span>
        <span className="min-w-0 flex-1 break-words">{entry.message}</span>
        {hasMetadata && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-expanded={open}
            aria-label={open ? en.log.hideMetadata : en.log.showMetadata}
            onClick={() => {
              setOpen(!open);
            }}
          >
            <Chevron aria-hidden="true" />
          </Button>
        )}
      </div>
      {open && (
        <pre className="m-0 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {JSON.stringify(entry.metadata, null, 2)}
        </pre>
      )}
    </li>
  );
}
