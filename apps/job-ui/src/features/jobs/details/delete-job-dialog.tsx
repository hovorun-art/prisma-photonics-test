import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { en } from '@/locales';

import { useDeleteJob } from '../hooks/use-delete-job';

/** "Delete job" with a confirmation; errors other than "already gone" stay in the dialog. */
export function DeleteJobDialog({ id }: { id: string }) {
  const navigate = useNavigate();
  const deletion = useDeleteJob(id, () => {
    void navigate('/jobs');
  });
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) deletion.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-10 border-destructive-border text-destructive hover:bg-destructive-muted hover:text-destructive"
        >
          {en.job.deleteJob}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{en.job.deleteTitle}</DialogTitle>
          <DialogDescription>{en.job.deleteDescription}</DialogDescription>
        </DialogHeader>
        {deletion.isError && (
          <p role="alert" className="m-0 text-[13px] text-destructive">
            {deletion.error.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{en.job.deleteCancel}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={deletion.isPending}
            onClick={() => {
              deletion.mutate();
            }}
          >
            {en.job.deleteConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
