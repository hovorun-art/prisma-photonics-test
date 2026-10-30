import { en } from '@/locales';

import { NotFoundCard } from './not-found-card';

/** Shown for an unknown or malformed job id, and when the open job disappears. */
export function JobNotFound() {
  return (
    <NotFoundCard
      title={en.job.notFoundTitle}
      hint={en.job.notFoundHint}
      to="/jobs"
      linkLabel={en.job.backToJobs}
    />
  );
}
