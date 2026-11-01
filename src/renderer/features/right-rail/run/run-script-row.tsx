import { useState, type ReactNode } from 'react';
import type { RunScriptState } from '@shared/lane-runs';
import { statusDotClass } from '@renderer/lib/status-dot';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { describeRunScriptRow } from './run-model';

/**
 * One run script: its title and status (Stopped / Running · URL / Exited n),
 * the actions that status allows, the URL it printed (opened in the
 * browser), a refused start said in the row itself, and its terminal on
 * demand once it has run.
 */
export function RunScriptRow({
  title,
  state,
  error,
  pending,
  onStart,
  onStop,
  onRestart,
  onOpenUrl,
  renderTerminal,
}: {
  title: string;
  state: RunScriptState | undefined;
  /** Why the last Start did not run, worded for the user; null when it did. */
  error: string | null;
  /** A Start, Stop or Restart is on its way. */
  pending: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenUrl: (url: string) => void;
  renderTerminal: (ptySessionId: string) => ReactNode;
}) {
  const row = describeRunScriptRow(state);
  const ptySessionId = state?.ptySessionId ?? null;

  return (
    <div role="group" aria-label={title} className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'inline-block size-[6px] shrink-0 rounded-full',
            statusDotClass(row.signal)
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-list-row text-text">{title}</span>
          <span className="truncate text-list-meta text-text-passive">
            {row.url ? 'Running · ' : row.label}
            {row.url && (
              <button
                type="button"
                onClick={() => onOpenUrl(row.url!)}
                className="cursor-pointer border-none bg-transparent p-0 font-mono text-list-meta text-text-muted hover:text-text hover:underline"
              >
                {row.url}
              </button>
            )}
          </span>
        </div>
        <RunActions
          row={row}
          pending={pending}
          onStart={onStart}
          onStop={onStop}
          onRestart={onRestart}
        />
      </div>
      {error && (
        <p role="alert" className="text-tiny tracking-tiny text-status-err">
          {error}
        </p>
      )}
      {ptySessionId && <RunTerminalToggle ptySessionId={ptySessionId} render={renderTerminal} />}
    </div>
  );
}

function RunActions({
  row,
  pending,
  onStart,
  onStop,
  onRestart,
}: {
  row: ReturnType<typeof describeRunScriptRow>;
  pending: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {row.canStart && (
        <Button variant="outline" size="xs" disabled={pending} onClick={onStart}>
          Start
        </Button>
      )}
      {row.canRestart && (
        <Button variant="ghost" size="xs" disabled={pending} onClick={onRestart}>
          Restart
        </Button>
      )}
      {row.canStop && (
        <Button variant="outline" size="xs" disabled={pending} onClick={onStop}>
          Stop
        </Button>
      )}
    </div>
  );
}

/** A process's terminal, shown on demand; its buffer outlives the process. */
export function RunTerminalToggle({
  ptySessionId,
  render,
}: {
  ptySessionId: string;
  render: (ptySessionId: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="self-start cursor-pointer border-none bg-transparent p-0 text-list-meta text-text-passive hover:text-text-muted"
      >
        {open ? 'Hide terminal' : 'Show terminal'}
      </button>
      {open && render(ptySessionId)}
    </>
  );
}
