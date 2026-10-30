import type { JobGroup } from '@job-queue/contracts';

import { Card } from '@/components/ui/card';
import { en } from '@/locales';

import { KeyValueList } from '../../jobs/details/key-value-list';
import { useJobPresenter } from '../../jobs/hooks/use-job-presenter';

/** The group's times as a key/value list (design "BatchJob", Details); "—" for one not set yet. */
export function GroupDetailsList({ group }: { group: JobGroup }) {
  const presenter = useJobPresenter();
  const dateTime = (at: string | null) => (at ? presenter.dateTime({ at }).text : en.group.notYet);
  const rows: [string, string][] = [
    [en.group.fields.created, dateTime(group.createdAt)],
    [en.group.fields.updated, dateTime(group.updatedAt)],
    [en.group.fields.checked, dateTime(group.checkedAt)],
    [en.group.fields.finished, dateTime(group.finishedAt)],
  ];
  return (
    <Card role="region" aria-label={en.group.details} className="gap-3 px-5 py-4 shadow-none">
      <h2 className="m-0 text-[15px] font-semibold">{en.group.details}</h2>
      <KeyValueList rows={rows} />
    </Card>
  );
}
