import { Skeleton } from '@/components/ui/skeleton';

/** The main column and the side column of a details page while it loads. */
export function DetailsSkeleton({ label }: { label: string }) {
  return (
    <div aria-label={label} aria-busy="true" className="flex flex-wrap items-start gap-5">
      <Skeleton className="h-64 min-w-0 flex-[999_1_560px] rounded-xl" />
      <Skeleton className="h-64 min-w-0 flex-[1_1_300px] rounded-xl" />
    </div>
  );
}
