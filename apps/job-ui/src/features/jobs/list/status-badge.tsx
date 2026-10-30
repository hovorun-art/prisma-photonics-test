import type { JobGroupStatus, JobStatus } from '@job-queue/contracts';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { GROUP_STATUS_STYLE, STATUS_STYLE } from '../model/status-style';

const BADGE_STYLE = { ...STATUS_STYLE, ...GROUP_STATUS_STYLE };

/** A job or group status as a coloured pill with a dot (design "Components"). */
export function StatusBadge({
  status,
  className,
}: {
  status: JobStatus | JobGroupStatus;
  className?: string;
}) {
  return (
    <Badge
      className={cn('h-6 gap-1.5 rounded-full border-0 px-[9px]', BADGE_STYLE[status], className)}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {en.statuses[status]}
    </Badge>
  );
}
