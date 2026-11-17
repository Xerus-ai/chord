import { useUpdateStore, type UpdateState } from '@renderer/lib/stores/update-store';
import { Button } from '@renderer/lib/ui/button';

/** What the main button does in each updater state; null while the updater is busy. */
function primaryAction(
  state: UpdateState,
  actions: {
    check: () => Promise<void>;
    download: () => Promise<void>;
    install: () => Promise<void>;
  }
): { label: string; run: () => Promise<void> } | null {
  switch (state.status) {
    case 'available':
      return { label: 'Download update', run: actions.download };
    case 'downloaded':
      return { label: 'Restart to update', run: actions.install };
    case 'checking':
    case 'downloading':
    case 'installing':
      return null;
    default:
      return { label: 'Check for updates', run: actions.check };
  }
}

function busyLabel(state: UpdateState): string {
  if (state.status === 'downloading')
    return `Downloading ${(state.progress?.percent ?? 0).toFixed(0)}%`;
  if (state.status === 'installing') return 'Installing…';
  return 'Checking…';
}

/**
 * Shown instead of the app when the sync server no longer supports this version
 * (devstation-mg6u.2). It drives the app's own updater; the download page is
 * always offered too, since the updater can be off, find nothing, or fail.
 */
export function UpdateRequired({ current, minimum }: { current: string; minimum: string }) {
  const state = useUpdateStore((s) => s.state);
  const check = useUpdateStore((s) => s.check);
  const download = useUpdateStore((s) => s.download);
  const install = useUpdateStore((s) => s.install);
  const openLatest = useUpdateStore((s) => s.openLatest);
  const primary = primaryAction(state, { check, download, install });

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 overflow-y-auto bg-surface p-6">
      <div className="flex max-w-[320px] flex-col items-center gap-1.5 text-center">
        <h1 className="text-title tracking-title font-semibold text-text">Update required</h1>
        <p className="text-body tracking-body text-text-muted">
          This version of Chord ({current}) is no longer supported by the sync server. Version{' '}
          {minimum} or newer is required.
        </p>
        {state.status === 'not-available' && (
          <p className="text-body tracking-body text-text-muted">
            No update was found automatically. Download the latest version instead.
          </p>
        )}
        {state.status === 'error' && (
          <p role="alert" className="text-body tracking-body text-status-err">
            {state.message}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="lg" disabled={primary === null} onClick={() => void primary?.run()}>
          {primary?.label ?? busyLabel(state)}
        </Button>
        <Button size="lg" variant="ghost" onClick={() => void openLatest()}>
          Download from the website (closes Chord)
        </Button>
      </div>
      <p aria-live="polite" className="sr-only">
        {primary === null ? busyLabel(state) : ''}
      </p>
    </main>
  );
}
