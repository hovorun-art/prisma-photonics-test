import type { JobStatus } from '@job-queue/contracts';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { STATUS_STYLE } from '../model/status-style';

/** A job status as a coloured pill with a dot (design "Components"). */
export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <Badge
      className={cn('h-6 gap-1.5 rounded-full border-0 px-[9px]', STATUS_STYLE[status], className)}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {en.statuses[status]}
    </Badge>
  );
}
