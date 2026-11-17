import { getProgressLabel, useUpdateStore } from '@renderer/lib/stores/update-store';
import { cn } from '@renderer/utils/utils';

function busyLabel(status: string): string | null {
  if (status === 'checking') return 'Checking...';
  if (status === 'downloading') return `Downloading ${getProgressLabel()}`;
  if (status === 'installing') return 'Installing...';
  return null;
}

const ACTION =
  'flex items-center gap-2 rounded-lg px-6 py-2 text-title tracking-title font-semibold transition-all duration-200';

/**
 * Shown instead of the app when the sync server no longer supports this version
 * (devstation-mg6u.2). It drives the app's own updater; when that cannot find or
 * fetch the update, the download page is the way out.
 */
export function UpdateRequired({ current, minimum }: { current: string; minimum: string }) {
  const state = useUpdateStore((s) => s.state);
  const check = useUpdateStore((s) => s.check);
  const download = useUpdateStore((s) => s.download);
  const install = useUpdateStore((s) => s.install);
  const openLatest = useUpdateStore((s) => s.openLatest);

  const busy =
    state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';
  const primary =
    state.status === 'downloaded'
      ? { label: 'Restart to update', run: install }
      : state.status === 'available'
        ? { label: 'Download update', run: download }
        : { label: busyLabel(state.status) ?? 'Check for updates', run: check };
  const stuck = state.status === 'error' || state.status === 'not-available';

  return (
    <main className="flex h-screen select-none flex-col items-center justify-center gap-4 bg-surface">
      <div className="flex flex-col items-center gap-1.5">
        <h1 className="text-title tracking-title font-semibold text-text">Update required</h1>
        <p className="max-w-[360px] text-center text-body tracking-body text-text-muted">
          This version of Chord ({current}) is no longer supported by the sync server. Version{' '}
          {minimum} or newer is required.
        </p>
        {state.status === 'error' && (
          <p className="max-w-[360px] text-center text-body tracking-body text-status-err">
            {state.message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => void primary.run()}
          disabled={busy}
          className={cn(
            ACTION,
            'bg-action-bg text-action-fg',
            busy ? 'cursor-wait opacity-70' : 'hover:bg-action-bg-hover'
          )}
        >
          {primary.label}
        </button>
        {stuck && (
          <button
            onClick={() => void openLatest()}
            className={cn(ACTION, 'text-text hover:bg-surface-hover')}
          >
            Open the download page
          </button>
        )}
      </div>
    </main>
  );
}
