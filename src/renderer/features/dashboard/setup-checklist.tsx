import { AlertTriangle, Check } from 'lucide-react';
import { cn } from '@renderer/utils/utils';

/**
 * 'unknown' is not 'pending': it means the check itself failed, so the
 * checklist must not claim the step is undone.
 */
export type ChecklistState = 'done' | 'pending' | 'unknown';

export interface ChecklistEntry {
  state: ChecklistState;
  /** Shown when state is 'unknown' — why the step could not be verified. */
  unknownNote?: string;
  onRetry?: () => void;
}

export interface SetupState {
  signedIn: ChecklistEntry;
  githubConnected: ChecklistEntry;
  hasTeam: ChecklistEntry;
  hasWorkItems: ChecklistEntry;
}

export function isSetupComplete(setup: SetupState): boolean {
  return Object.values(setup).every((entry) => entry.state === 'done');
}

export function SetupChecklist({
  setup,
  onAction,
}: {
  setup: SetupState;
  onAction?: (key: string) => void;
}) {
  const entries = Object.values(setup);
  const doneCount = entries.filter((entry) => entry.state === 'done').length;

  return (
    <section className="mb-7">
      <div className="mb-1.5 flex h-6 items-center gap-1.5">
        <span className="section-header">Get set up</span>
        <span className="section-header tabular-nums font-medium">
          {doneCount}/{entries.length}
        </span>
      </div>
      <ChecklistItem entry={setup.signedIn} label="Sign in to your account" />
      <ChecklistItem
        entry={setup.githubConnected}
        label="Connect GitHub for PR tracking"
        action="Connect"
        onAction={() => onAction?.('connect-github')}
      />
      <ChecklistItem
        entry={setup.hasTeam}
        label="Invite a teammate to collaborate"
        action="Invite"
        onAction={() => onAction?.('invite')}
      />
      <ChecklistItem
        entry={setup.hasWorkItems}
        label="Start your first work session"
        action="Create"
        onAction={() => onAction?.('create')}
      />
    </section>
  );
}

function ChecklistItem({
  entry,
  label,
  action,
  onAction,
}: {
  entry: ChecklistEntry;
  label: string;
  action?: string;
  onAction?: () => void;
}) {
  const { state, unknownNote, onRetry } = entry;
  const done = state === 'done';
  const unknown = state === 'unknown';

  return (
    <div className="flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-surface-hover">
      {unknown ? (
        <AlertTriangle className="size-4 shrink-0 text-status-err" />
      ) : (
        <div
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-[background-color,border-color] duration-200',
            done ? 'border-action-bg bg-action-bg' : 'border-border-strong'
          )}
        >
          {done && <Check className="size-2.5 text-action-fg" strokeWidth={3} />}
        </div>
      )}
      <div className="flex-1">
        <span
          className={cn(
            'text-body tracking-body',
            done ? 'text-text-passive line-through decoration-border-strong' : 'text-text-muted'
          )}
        >
          {label}
        </span>
        {unknown && unknownNote && (
          <p className="mt-0.5 break-words text-tiny tracking-tiny text-status-err">
            {unknownNote}
          </p>
        )}
      </div>
      {unknown && onRetry ? (
        <button
          onClick={onRetry}
          className="h-6 rounded-md border border-border px-2.5 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          Retry
        </button>
      ) : (
        action &&
        !done &&
        !unknown && (
          <button
            onClick={onAction}
            className="h-6 rounded-md border border-border px-2.5 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            {action}
          </button>
        )
      )}
    </div>
  );
}
