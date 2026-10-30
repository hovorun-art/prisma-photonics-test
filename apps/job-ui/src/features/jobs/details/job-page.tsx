import { useParams } from 'react-router';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { en } from '@/locales';

import { TransitReport } from '../../transit-map';
import { ApiError } from '../api/api-error';
import { useJob } from '../hooks/use-job';
import { Breadcrumb } from './breadcrumb';
import { DetailsSkeleton } from './details-skeleton';
import { JobDetailsList } from './job-details-list';
import { JobHeader } from './job-header';
import { JobNotFound } from './job-not-found';
import { JobLogCard } from './job-log-card';
import { JsonCard } from './json-card';
import { Lifecycle } from './lifecycle';

/** One job (design "JobDetail"), refreshed by polling; a completed transit job shows its report. */
export function JobPage() {
  const { id = '' } = useParams();
  const query = useJob(id);
  const notFound =
    !query.isValidId || (query.error instanceof ApiError && query.error.code === 'JOB_NOT_FOUND');
  if (notFound) return <JobNotFound />;

  const job = query.data;
  return (
    <>
      <Breadcrumb label={en.job.breadcrumb} parent={en.job.jobs} to="/jobs" id={id} />
      {job?.type === 'flight-transit' && job.status === 'completed' && job.result ? (
        <TransitReport job={{ ...job, result: job.result }} connectionLost={query.isError} />
      ) : job ? (
        <>
          <JobHeader job={job} connectionLost={query.isError} />
          {job.status === 'failed' && (
            <Alert variant="destructive" className="border-destructive-border bg-destructive-muted">
              <AlertTitle>{en.job.failedTitle(job.attempts, job.maxAttempts)}</AlertTitle>
              <AlertDescription>{job.error?.message}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-start gap-5">
            <div className="grid min-w-0 flex-[999_1_560px] grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
              <JsonCard title={en.job.payload} value={job.payload} />
              {job.status === 'completed' && <JsonCard title={en.job.result} value={job.result} />}
              {job.status === 'failed' && <JsonCard title={en.job.error} value={job.error} />}
            </div>
            <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
              <Lifecycle job={job} />
              <JobDetailsList job={job} />
            </aside>
          </div>
          <JobLogCard jobId={job.id} />
        </>
      ) : (
        <DetailsSkeleton label={en.job.loading} />
      )}
    </>
  );
}
