import { Card } from '@/components/ui/card';

/** A details page's "Details" card (designs "JobDetail", "BatchJob"): a title over key/value rows. */
export function DetailsCard({
  label,
  rows,
}: {
  label: string;
  rows: readonly (readonly [string, string])[];
}) {
  return (
    <Card role="region" aria-label={label} className="gap-3 px-5 py-4 shadow-none">
      <h2 className="m-0 text-[15px] font-semibold">{label}</h2>
      <dl className="m-0 flex flex-col">
        {rows.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3 border-t border-[#F3F3F1] py-2">
            <dt className="text-[13px] text-muted-foreground">{key}</dt>
            <dd className="m-0 text-right font-mono text-xs break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
