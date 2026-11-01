import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';

/**
 * `full`: files and the agent's conversation go back to this turn (Claude,
 * Codex). `files`: only the files do, for an agent Chord cannot rewind (ACP,
 * or a turn from before history refs).
 */
export type ResetMode = 'full' | 'files';

function describeMemory(agentName: string, mode: ResetMode, laterTurns: number): string {
  if (mode === 'files') return `${agentName} keeps its memory of later turns.`;
  if (laterTurns === 0) return `${agentName}'s memory already ends at this turn.`;
  if (laterTurns === 1) return `${agentName} forgets the turn after it.`;
  return `${agentName} forgets the ${laterTurns} turns after it.`;
}

/**
 * `memory` is what the confirm says about the agent's memory, fixed when it
 * opens: the Reset's own marker lands while it runs and would otherwise
 * rewrite it under the user ("forgets the turn after it" -> "already ends").
 */
type ControlState =
  | { step: 'idle'; error: string | null }
  | { step: 'confirm'; memory: string }
  | { step: 'resetting'; memory: string };

/**
 * The turn footer's Reset (plan §"Decisions for Phase 5"): a confirm that
 * states what happens to the files, the agent's memory and commits, then the
 * reset itself. `waitReason` holds it while the agent is working; a failure
 * is shown in place and the reset can be tried again.
 */
export function ResetTurnControl({
  agentName,
  mode,
  laterTurns,
  waitReason,
  onReset,
}: {
  agentName: string;
  mode: ResetMode;
  /** The session's later turns the agent still remembers. */
  laterTurns: number;
  waitReason: string | null;
  onReset: () => Promise<void>;
}) {
  const [state, setState] = useState<ControlState>({ step: 'idle', error: null });
  const label = mode === 'full' ? 'Reset to here' : 'Reset files to here';
  const open = state.step !== 'idle';
  const error = state.step === 'idle' ? state.error : null;

  const confirm = async (memory: string) => {
    setState({ step: 'resetting', memory });
    try {
      await onReset();
      setState({ step: 'idle', error: null });
    } catch (e) {
      setState({ step: 'idle', error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <span
      className={`relative flex items-center gap-2 transition-opacity duration-100 ease-out focus-within:opacity-100 group-hover/turn:opacity-100 ${
        open || error || waitReason ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* A portal, not an absolute box: the transcript's rows are translated,
          so a box inside this row would sit under the rows after it. */}
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next)
            setState({ step: 'confirm', memory: describeMemory(agentName, mode, laterTurns) });
          else if (state.step === 'confirm') setState({ step: 'idle', error: null });
        }}
      >
        <PopoverTrigger
          disabled={waitReason !== null || state.step === 'resetting'}
          title={waitReason ?? undefined}
          className="flex cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-0 py-0.5 text-tiny tracking-tiny text-text-muted hover:text-text disabled:cursor-default disabled:hover:text-text-muted"
        >
          <Undo2 className="size-icon-xs" />
          {label}
        </PopoverTrigger>
        <PopoverContent
          aria-label={label}
          align="start"
          className="w-80 gap-0 border border-border-strong bg-surface-inset p-3 text-tiny tracking-tiny text-text-muted"
        >
          <p className="m-0 text-text">
            Files go back to how they were after this turn. Current files are saved as a checkpoint
            first.
          </p>
          <p className="m-0 mt-1">{state.step === 'idle' ? null : state.memory}</p>
          <p className="m-0 mt-1">Commits made since stay on the branch.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setState({ step: 'idle', error: null })}
              disabled={state.step === 'resetting'}
              className="cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-tiny tracking-tiny text-text-muted hover:text-text disabled:cursor-default"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (state.step === 'confirm') void confirm(state.memory);
              }}
              disabled={state.step === 'resetting'}
              className="cursor-pointer rounded-md border border-status-err-border bg-status-err-bg px-2 py-1 text-tiny tracking-tiny font-medium text-status-err hover:bg-status-err-bg-strong disabled:cursor-default"
            >
              {state.step === 'resetting' ? 'Resetting…' : 'Reset'}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {waitReason && (
        <span className="text-tiny tracking-tiny text-text-passive">{waitReason}</span>
      )}
      {error && <span className="text-tiny tracking-tiny text-status-err">{error}</span>}
    </span>
  );
}
