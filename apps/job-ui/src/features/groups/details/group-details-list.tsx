import type { JobGroup } from '@job-queue/contracts';

import { en } from '@/locales';

import { DetailsCard } from '../../jobs/details/details-card';
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
  return <DetailsCard label={en.group.details} rows={rows} />;
}
