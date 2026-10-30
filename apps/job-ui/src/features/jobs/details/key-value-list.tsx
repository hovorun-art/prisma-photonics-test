import { cn } from '@/lib/class-names';

/** Labels on the left, monospace values on the right (designs "TransitReport", "JobDetail"). */
export function KeyValueList({
  rows,
  size = 'sm',
}: {
  rows: readonly (readonly [string, string])[];
  size?: 'sm' | 'xs';
}) {
  return (
    <dl
      className={cn(
        'm-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3',
        size === 'sm' ? 'gap-y-1.5 text-[13px]' : 'gap-y-1 text-xs',
      )}
    >
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className={cn('m-0 text-right font-mono', size === 'sm' && 'text-xs')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
