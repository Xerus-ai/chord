import { useState } from 'react';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type ArchiveLaneDialogArgs = {
  title: string;
  description: string;
  /** A merged lane that loses nothing: "Also delete the branch", checked. */
  offerBranchDelete: boolean;
};

type Props = BaseModalProps<{ deleteBranch: boolean }> & ArchiveLaneDialogArgs;

/** Archive's confirm (`describeLaneArchiveConfirm`), with the branch option when it is safe. */
export function ArchiveLaneDialog({
  title,
  description,
  offerBranchDelete,
  onSuccess,
  onClose,
}: Props) {
  const [deleteBranch, setDeleteBranch] = useState(offerBranchDelete);
  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle className="font-sans text-body normal-case tracking-normal text-text">
          {title}
        </DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <p>{description}</p>
        {offerBranchDelete && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-body tracking-body text-text">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(event) => setDeleteBranch(event.target.checked)}
              className="accent-current"
            />
            Also delete the branch
          </label>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {/* A plain button, not ConfirmButton: its shortcut setting is read over
            IPC, and this dialog stays free of it (its browser test renders it). */}
        <Button onClick={() => onSuccess({ deleteBranch: offerBranchDelete && deleteBranch })}>
          Archive
        </Button>
      </DialogFooter>
    </>
  );
}
