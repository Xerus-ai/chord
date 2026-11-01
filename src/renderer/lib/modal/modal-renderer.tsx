import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useEffect, useState } from 'react';
import {
  modalRegistry,
  type ModalRegistryEntry,
  type ModalSize,
} from '@renderer/app/modal-registry';
import { Dialog, DialogOverlay, DialogPortal } from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';
import { useModalStore } from './modal-store';

const SIZE_CLASSES: Record<ModalSize, string> = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

export function ModalRenderer() {
  const activeModalId = useModalStore((s) => s.activeModalId);
  const activeModalArgs = useModalStore((s) => s.activeModalArgs);
  const modalInstanceId = useModalStore((s) => s.modalInstanceId);
  const isOpen = useModalStore((s) => s.isOpen);
  const closeGuardActive = useModalStore((s) => s.closeGuardActive);

  const entry = (
    activeModalId ? modalRegistry[activeModalId as keyof typeof modalRegistry] : null
  ) as ModalRegistryEntry | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component = entry?.component as React.ComponentType<any> | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lastComponent, setLastComponent] = useState<React.ComponentType<any> | null>(null);
  const [lastArgs, setLastArgs] = useState<Record<string, unknown> | null>(null);
  const [lastEntry, setLastEntry] = useState<ModalRegistryEntry | null>(null);
  const [lastInstanceId, setLastInstanceId] = useState(0);

  useEffect(() => {
    if (isOpen && Component && activeModalArgs) {
      setLastComponent(() => Component); // eslint-disable-line react-hooks/set-state-in-effect
      setLastArgs(activeModalArgs);
      setLastEntry(entry);
      setLastInstanceId(modalInstanceId);
    }
  }, [isOpen, Component, activeModalArgs, entry, modalInstanceId]);

  const DisplayComponent = lastComponent;
  const displayArgs = lastArgs;
  const displayEntry = lastEntry;

  const handleOpenChange = (
    open: boolean,
    eventDetails: DialogPrimitive.Root.ChangeEventDetails
  ) => {
    if (!open && isOpen) {
      const isPassiveDismiss =
        eventDetails.reason === 'outside-press' || eventDetails.reason === 'escape-key';
      if (closeGuardActive && isPassiveDismiss) return;
      useModalStore.getState().closeModal();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          finalFocus={false}
          data-slot="dialog-content"
          onKeyDownCapture={(e) => {
            if ((e.metaKey || e.ctrlKey || e.altKey) && e.key === 'Enter') {
              e.preventDefault();
            }
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex flex-col w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 bg-surface-raised text-body tracking-body ring-1 ring-text/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out rounded-lg overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
            SIZE_CLASSES[displayEntry?.size ?? 'md']
          )}
        >
          {/* Keyed per showModal call: modals stay mounted through the close
              animation and are reused across entities — without the key, a
              reopen for a different entity inherited the previous instance's
              component state. */}
          {DisplayComponent && displayArgs ? (
            <DisplayComponent key={lastInstanceId} {...displayArgs} />
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
