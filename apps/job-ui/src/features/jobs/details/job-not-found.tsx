import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { en } from '@/locales';

/** Shown for an unknown or malformed job id, and when the open job disappears. */
export function JobNotFound() {
  return (
    <Card className="items-center gap-3 px-5 py-14 text-center shadow-none">
      <h1 className="m-0 text-lg font-semibold">{en.job.notFoundTitle}</h1>
      <p className="m-0 text-[13px] text-muted-foreground">{en.job.notFoundHint}</p>
      <Button asChild variant="outline" className="no-underline">
        <Link to="/jobs">{en.job.backToJobs}</Link>
      </Button>
    </Card>
  );
}
