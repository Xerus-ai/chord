import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast bg-surface text-text border border-border shadow-lg',
          description: 'text-text-muted',
          actionButton: 'bg-action-bg text-action-fg',
          cancelButton: 'bg-surface-inset text-text-muted',
          error: 'text-status-err border-status-err-border/50',
        },
      }}
    />
  );
}
