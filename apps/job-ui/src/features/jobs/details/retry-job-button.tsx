import { RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { en } from '@/locales';

import { useChangeJobStatus } from '../hooks/use-change-job-status';

/** "Retry job", without a confirmation; an API error shows next to it. */
export function RetryJobButton({ id }: { id: string }) {
  const retry = useChangeJobStatus(id, 'pending');
  return (
    <>
      {retry.isError && (
        <p role="alert" className="m-0 text-[13px] text-destructive">
          {retry.error.message}
        </p>
      )}
      <Button
        className="h-10"
        disabled={retry.isPending}
        onClick={() => {
          retry.mutate();
        }}
      >
        <RotateCw aria-hidden="true" />
        {en.job.retryJob}
      </Button>
    </>
  );
}
