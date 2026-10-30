import { en } from '@/locales';

/** "Live" while polling works; adds "Connection lost, retrying" while the last poll failed. */
export function LiveIndicator({ connectionLost }: { connectionLost: boolean }) {
  return (
    <div className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
      <span className="size-2 rounded-full bg-link" aria-hidden="true" />
      {en.list.live}
      {connectionLost && (
        <>
          <span aria-hidden="true">·</span>
          <span role="status" className="font-medium text-destructive">
            {en.list.connectionLost}
          </span>
        </>
      )}
    </div>
  );
}
