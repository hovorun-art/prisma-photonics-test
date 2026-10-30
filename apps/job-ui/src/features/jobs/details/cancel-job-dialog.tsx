import { en } from '@/locales';

import { useChangeJobStatus } from '../hooks/use-change-job-status';
import { ConfirmJobDialog } from './confirm-job-dialog';

/**
 * "Cancel job" with a confirmation; an API error stays in the dialog. On success the job is no
 * longer cancellable, so the button and its dialog go away.
 */
export function CancelJobDialog({ id }: { id: string }) {
  const cancel = useChangeJobStatus(id, 'cancelled');
  return (
    <ConfirmJobDialog
      triggerLabel={en.job.cancelJob}
      title={en.job.cancelTitle}
      description={en.job.cancelDescription}
      confirmLabel={en.job.cancelConfirm}
      action={cancel}
    />
  );
}
