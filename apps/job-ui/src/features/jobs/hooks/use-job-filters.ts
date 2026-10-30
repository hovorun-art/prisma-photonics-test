import { JobStatus, JobType } from '@job-queue/contracts';
import { useSearchParams } from 'react-router';

import type { JobListFilters } from '../api/jobs-api';

/**
 * The jobs list filters, kept only in the page URL (`?status=failed&type=webhook`), so a filtered
 * list can be shared, survives a reload and Back restores it. A value that is not a known status or
 * type counts as All and is never sent to the API. Each change is a new history entry; a filter set
 * to All is left out of the URL.
 */
export function useJobFilters() {
  const [params, setParams] = useSearchParams();
  const status = JobStatus.safeParse(params.get('status'));
  const type = JobType.safeParse(params.get('type'));
  const filters: JobListFilters = {
    ...(status.success ? { status: status.data } : {}),
    ...(type.success ? { type: type.data } : {}),
  };

  const setFilters = (next: JobListFilters) => {
    setParams({
      ...(next.status === undefined ? {} : { status: next.status }),
      ...(next.type === undefined ? {} : { type: next.type }),
    });
  };

  return { filters, setFilters };
}
