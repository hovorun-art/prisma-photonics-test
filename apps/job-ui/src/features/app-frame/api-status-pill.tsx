import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { useQueueStats } from '../jobs/hooks/use-queue-stats';

/**
 * The header's API status, from the statistics poll the jobs list also uses: online while the latest
 * statistics request succeeded, offline when it failed, and "API status —" until the first answer.
 */
export function ApiStatusPill() {
  const { isPending, isError } = useQueueStats();
  const state = isError ? 'offline' : isPending ? 'unknown' : 'online';
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px]',
        state === 'unknown' ? 'text-subtle-foreground' : 'text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          state === 'online' && 'bg-status-completed',
          state === 'offline' && 'bg-status-failed',
          state === 'unknown' && 'bg-disabled-foreground',
        )}
      />
      {state === 'online'
        ? en.frame.apiOnline
        : state === 'offline'
          ? en.frame.apiOffline
          : en.frame.apiStatus}
    </span>
  );
}
