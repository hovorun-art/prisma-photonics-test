import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { CopyButton } from './copy-button';

/** A titled card with pretty-printed JSON and a Copy button (design "JobDetail"), and an optional note by the title. */
export function JsonCard({ title, value, note }: { title: string; value: unknown; note?: string }) {
  const json = JSON.stringify(value, null, 2);
  return (
    <Card role="region" aria-label={title} className="gap-0 overflow-hidden py-0 shadow-none">
      <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
        <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
        {note && (
          <span className="ml-auto pr-3 font-mono text-xs text-muted-foreground">{note}</span>
        )}
        <CopyButton text={json} label={en.copy.copy} size="sm" className="h-[30px] text-xs" />
      </div>
      <pre className="m-0 p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {json}
      </pre>
    </Card>
  );
}
