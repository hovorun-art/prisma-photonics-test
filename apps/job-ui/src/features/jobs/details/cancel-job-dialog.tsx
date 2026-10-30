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

import { useChangeJobStatus } from '../hooks/use-change-job-status';

/**
 * "Cancel job" with a confirmation; an API error stays in the dialog. On success the job is no
 * longer cancellable, so the button and its dialog go away.
 */
export function CancelJobDialog({ id }: { id: string }) {
  const cancel = useChangeJobStatus(id, 'cancelled');
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) cancel.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10">
          {en.job.cancelJob}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{en.job.cancelTitle}</DialogTitle>
          <DialogDescription>{en.job.cancelDescription}</DialogDescription>
        </DialogHeader>
        {cancel.isError && (
          <p role="alert" className="m-0 text-[13px] text-destructive">
            {cancel.error.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{en.job.deleteCancel}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate();
            }}
          >
            {en.job.cancelConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
