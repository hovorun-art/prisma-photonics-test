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

/** The request a confirmed action sends: its state, as a TanStack mutation reports it. */
export interface ConfirmedAction {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: { readonly message: string } | null;
  mutate(): void;
  reset(): void;
}

/**
 * A job action behind a confirmation: the trigger button opens a dialog whose confirm button sends
 * `action` and is disabled while it is in flight; an error stays in the dialog until it is closed.
 * "Keep job" closes it without sending anything.
 */
export function ConfirmJobDialog({
  triggerLabel,
  triggerClassName,
  title,
  description,
  confirmLabel,
  action,
}: {
  triggerLabel: string;
  triggerClassName?: string;
  title: string;
  description: string;
  confirmLabel: string;
  action: ConfirmedAction;
}) {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) action.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className={triggerClassName ?? 'h-10'}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {action.isError && action.error !== null && (
          <p role="alert" className="m-0 text-[13px] text-destructive">
            {action.error.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{en.job.deleteCancel}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={action.isPending}
            onClick={() => {
              action.mutate();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
