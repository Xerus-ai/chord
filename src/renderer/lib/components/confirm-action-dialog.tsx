import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type ConfirmActionDialogArgs = {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'destructive' | 'default';
};

type Props = BaseModalProps<void> & ConfirmActionDialogArgs;

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'destructive',
  onSuccess,
  onClose,
}: Props) {
  return (
    <>
      <DialogHeader showCloseButton={false}>
        {/* A confirm's title is the question it asks, naming what it acts on —
            a branch, a file, a work item — which is case-sensitive. It reads
            as text, not as the other dialogs' small uppercase section label
            (devstation-aua). */}
        <DialogTitle className="font-sans text-body normal-case tracking-normal text-text">
          {title}
        </DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <p>{description}</p>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton variant={variant} onClick={() => onSuccess()}>
          {confirmLabel}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
