import { Button } from '@/components/ui/button';
import { en } from '@/locales';

/** "Showing x–y of total" with Previous and Next (design "Main"). */
export function JobsPager({
  offset,
  shown,
  total,
  onPrevious,
  onNext,
}: {
  offset: number;
  shown: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[13px] text-muted-foreground">
      <span>{shown > 0 ? en.list.showing(offset + 1, offset + shown, total) : null}</span>
      <div className="flex gap-2">
        <Button variant="outline" disabled={offset === 0} onClick={onPrevious}>
          {en.list.previous}
        </Button>
        <Button variant="outline" disabled={offset + shown >= total} onClick={onNext}>
          {en.list.next}
        </Button>
      </div>
    </div>
  );
}
