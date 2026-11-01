import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentTurn } from '@shared/stream-items';
import { FileChangesStrip, type FileChangeEntry } from './file-changes-strip';
import { ResetTurnControl } from './reset-turn-control';
import { TurnArtifactChips, type OpenArtifactHandler } from './turn-artifact-chips';
import type { TurnArtifact } from './turn-artifacts';
import { TurnForkMenu } from './turn-fork-menu';
import type { TurnHistoryAction } from './turn-history-actions';

export function formatTurnDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

/** The turn's response text as markdown — text items only, tools/thinking excluded. */
export function turnTextAsMarkdown(turn: AgentTurn): string {
  return turn.items
    .filter((item) => item.kind === 'text')
    .map((item) => item.text)
    .join('\n\n');
}

function collectFileChanges(turn: AgentTurn): FileChangeEntry[] {
  const seen = new Set<string>();
  const files: FileChangeEntry[] = [];
  for (const item of turn.items) {
    if (item.kind !== 'file_changes') continue;
    for (const file of item.files) {
      if (seen.has(file.filePath)) continue;
      seen.add(file.filePath);
      files.push(file);
    }
  }
  return files;
}

/**
 * Footer under a completed agent turn: the files it created as document
 * chips, then duration · tokens · cost, copy-as-markdown, Reset (or one line
 * saying why there is none) and the Fork menu (owner view only — the
 * participant view passes no `history`), and the turn's file changes as a
 * collapsed strip.
 * `documentChips` is the owner's "Add to artifacts" row, rendered by the
 * caller so this footer stays free of IPC.
 * Duration is absent on turns persisted before startedAt was stamped.
 */
export function TurnFooter({
  turn,
  artifacts,
  workItemId,
  workspaceRoot,
  onOpenArtifact,
  history,
  documentChips,
  driftNotices,
}: {
  turn: AgentTurn;
  artifacts: TurnArtifact[];
  workItemId: string;
  workspaceRoot: string | null;
  onOpenArtifact?: OpenArtifactHandler;
  /** Reset and Fork for this turn; owner view only. */
  history?: TurnHistoryAction;
  documentChips?: ReactNode;
  /** The owner's out-of-date notices for this turn's artifacts, rendered by the caller like documentChips. */
  driftNotices?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );

  const markdown = turnTextAsMarkdown(turn);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(markdown);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  }, [markdown]);

  if (turn.status !== 'complete') return null;

  const endMs = turn.completedAt ?? turn.timestamp * 1000;
  const durationMs = turn.startedAt != null ? endMs - turn.startedAt : null;
  // A turn that genuinely reported 0 input tokens still has usage to show —
  // a truthiness check treated it as "no usage recorded".
  const tokens =
    turn.usage?.inputTokens != null
      ? turn.usage.inputTokens + (turn.usage.outputTokens ?? 0)
      : null;
  const fileChanges = collectFileChanges(turn);

  if (
    durationMs == null &&
    tokens == null &&
    !markdown &&
    fileChanges.length === 0 &&
    artifacts.length === 0 &&
    !documentChips &&
    !history
  ) {
    return null;
  }

  return (
    <div className="mt-2">
      <TurnArtifactChips
        artifacts={artifacts}
        workItemId={workItemId}
        workspaceRoot={workspaceRoot}
        onOpenArtifact={onOpenArtifact}
      />
      {driftNotices}
      {documentChips}
      <div className="mt-2 flex items-center gap-3 text-tiny tracking-tiny text-text-muted">
        {durationMs != null && <span>{formatTurnDuration(durationMs)}</span>}
        {durationMs != null && tokens != null && <span>·</span>}
        {tokens != null && (
          <span>
            {tokens} tokens
            {turn.usage?.totalCostUsd != null && (
              <span> · ${turn.usage.totalCostUsd.toFixed(4)}</span>
            )}
          </span>
        )}
        {markdown && (
          <button
            onClick={handleCopy}
            title="Copy response as markdown"
            className="flex cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-0 py-0.5 text-tiny tracking-tiny text-text-muted opacity-0 transition-[color,opacity] duration-100 ease-out hover:text-text focus-visible:opacity-100 group-hover/turn:opacity-100"
          >
            {copied ? (
              <Check className="size-icon-xs text-status-ok" />
            ) : (
              <Copy className="size-icon-xs" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        {history?.reset && (
          <ResetTurnControl
            agentName={turn.agentName}
            mode={history.reset.mode}
            laterTurns={history.reset.laterTurns}
            waitReason={history.reset.waitReason}
            onReset={history.reset.onReset}
          />
        )}
        {history?.unavailable && (
          <span className="text-tiny tracking-tiny text-text-passive opacity-0 transition-opacity duration-100 ease-out group-hover/turn:opacity-100">
            {history.unavailable}
          </span>
        )}
        {history?.forkToNewTab && (
          <TurnForkMenu
            onForkToNewTab={history.forkToNewTab}
            onForkToNewWorktree={history.forkToNewWorktree ?? undefined}
          />
        )}
      </div>
      {fileChanges.length > 0 && <FileChangesStrip files={fileChanges} />}
    </div>
  );
}
