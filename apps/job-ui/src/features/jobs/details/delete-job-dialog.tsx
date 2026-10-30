import { useNavigate } from 'react-router';

import { en } from '@/locales';

import { useDeleteJob } from '../hooks/use-delete-job';
import { ConfirmJobDialog } from './confirm-job-dialog';

/** "Delete job" with a confirmation; errors other than "already gone" stay in the dialog. */
export function DeleteJobDialog({ id }: { id: string }) {
  const navigate = useNavigate();
  const deletion = useDeleteJob(id, () => {
    void navigate('/jobs');
  });
  return (
    <ConfirmJobDialog
      triggerLabel={en.job.deleteJob}
      triggerClassName="h-10 border-destructive-border text-destructive hover:bg-destructive-muted hover:text-destructive"
      title={en.job.deleteTitle}
      description={en.job.deleteDescription}
      confirmLabel={en.job.deleteConfirm}
      action={deletion}
    />
  );
}
