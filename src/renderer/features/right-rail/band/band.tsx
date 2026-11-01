import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitMerge,
  Loader2,
  MessageSquareWarning,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { useParticipants } from '@renderer/features/work-list/use-participants';
import type { MergeStrategy } from '@renderer/features/work-list/use-pr-actions';
import { useWorkItemViewers } from '@renderer/features/work-list/use-viewing-presence';
import { AvatarStack } from '@renderer/lib/components/chrome/avatar-stack';
import { rpc } from '@renderer/lib/ipc';
import { statusTextClass } from '@renderer/lib/status-dot';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { RailError } from '../rail-primitives';
import type { BandAction, BandActionKind, BandReason } from './band-policy';
import type { BandState, BandStateGlyph } from './band-state';
import { BandStateLabel } from './band-state-label';
import { CommitPopover } from './commit-popover';
import type { BandModel } from './use-band-model';

/** The band's one button and its ladder: the owner's; a teammate's band has none. */
export type BandActions = Pick<
  BandModel,
  | 'primary'
  | 'menu'
  | 'busy'
  | 'error'
  | 'changedCount'
  | 'commitMessage'
  | 'setCommitMessage'
  | 'commitGeneration'
  | 'run'
>;

const STATE_ICON: Record<BandStateGlyph, ComponentType<{ className?: string }>> = {
  conflict: TriangleAlert,
  'check-failed': XCircle,
  'check-running': Loader2,
  'changes-requested': MessageSquareWarning,
  merged: GitMerge,
  ready: CheckCircle2,
  changes: FileDiff,
  ahead: ArrowUp,
  branch: GitBranch,
};

export const BAND_ACTION_LABELS: Record<BandActionKind, string> = {
  'resolve-conflicts': 'Resolve conflicts',
  commit: 'Commit',
  publish: 'Publish',
  push: 'Push',
  'create-pr': 'Create PR',
  pull: 'Pull',
  merge: 'Merge',
  'mark-done': 'Mark done',
  approve: 'Approve',
  'ask-agent-to-build': 'Ask agent to build',
};

/**
 * Prose for the policy's reason codes — the only place this wording exists, so
 * a disabled entry explains itself in one voice.
 */
const REASON_TEXT: Record<BandReason, string> = {
  'no-checkout': 'This worktree has no checkout on this device',
  'conflicts-present': 'Resolve the conflicts first',
  'nothing-to-commit': 'Nothing to commit',
  'no-commit-message': 'Write a commit message first',
  'no-branch': 'This worktree is on a detached HEAD',
  'already-published': 'This branch is already on the remote',
  'not-published': 'Publish the branch first',
  'no-remote': 'This repository has no remote to push to',
  'publication-loading': 'Checking whether this branch is on the remote…',
  'nothing-to-push': 'Nothing to push',
  'lanes-loading': 'Checking this branch’s pull request…',
  'pr-exists': 'This branch already has a pull request',
  'no-github-remote': 'This repository has no GitHub remote',
  busy: 'Another action is running',
  'not-mergeable': 'GitHub will not merge this pull request yet',
  'pr-not-merged': 'The pull request is not merged yet',
  'already-done': 'This work item is already done',
  'no-artifact': 'Open an artifact to act on it',
  'already-approved': 'This artifact is already approved',
  participant: 'Only the owner can act on this work item',
};

const MERGE_STRATEGIES: { value: MergeStrategy; label: string }[] = [
  { value: 'merge', label: 'Merge commit' },
  { value: 'squash', label: 'Squash and merge' },
  { value: 'rebase', label: 'Rebase and merge' },
];

/**
 * The rail's top row, for every viewer: where this work item is, who is on it,
 * and the one thing to do next.
 *
 * It replaces the tab strip as the rail's first row, so it inherits both of
 * that row's other jobs — it is the window's drag region, and it clears the OS
 * window controls. The state text is the only element allowed to truncate;
 * the button never is, because a band whose action is cut off states nothing
 * the tabs below do not already say. A teammate's band keeps the shape with
 * no button (`actions` null): every rung acts on a checkout they do not have.
 * What replaces it is the one fact they need and the owner does not: how old
 * this view is (`syncedAt`).
 */
export function StatusBand({
  workItemId,
  state,
  prNumber,
  prUrl,
  actions,
  syncedAt,
}: {
  workItemId: string;
  state: BandState;
  prNumber: number | null;
  prUrl: string | null;
  actions: BandActions | null;
  /** When the owner last pushed the snapshot a teammate reads; null for the owner. */
  syncedAt: string | null;
}) {
  const { participants } = useParticipants(workItemId);
  const viewers = useWorkItemViewers(workItemId);
  const [commitOpen, setCommitOpen] = useState(false);

  const StateIcon = STATE_ICON[state.glyph];

  return (
    <div className="app-drag-region pr-window-controls relative flex shrink-0 flex-col border-b border-border">
      <div className="flex h-11 items-center gap-2 pl-3">
        {prNumber && (
          <button
            type="button"
            onClick={() => prUrl && void rpc.app.openExternal(prUrl)}
            disabled={!prUrl}
            title={prUrl ?? 'No pull request URL yet'}
            className="flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-transparent px-1.5 text-list-meta text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-default"
          >
            #{prNumber}
            <ExternalLink className="size-icon-xs" />
          </button>
        )}

        {/* The state words take the form that fits beside the glyph — the
            sentence, its short form, or the glyph alone — never one cut to
            "12 unco…" or "N.." (devstation-u59). */}
        <span
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 text-list-row font-medium',
            statusTextClass(state.signal)
          )}
          title={state.text}
        >
          <StateIcon
            className={cn(
              'size-icon-sm shrink-0',
              state.glyph === 'check-running' && 'animate-spin'
            )}
          />
          <BandStateLabel state={state} />
        </span>

        {syncedAt && (
          <span className="shrink-0 text-list-meta text-text-passive">
            Last synced <RelativeTime value={new Date(syncedAt).getTime()} compact />
          </span>
        )}

        {/* Roster only. Share went back to the centre topbar, where it reads as
            a chat-level action; the rail's one Share is the People section's
            own attach action in the Work item tab. */}
        <span className="flex shrink-0 items-center">
          <AvatarStack members={participants} viewers={viewers} />
        </span>

        {actions && (
          <BandButton
            primary={actions.primary}
            menu={actions.menu}
            busy={actions.busy}
            onRun={(kind, strategy) => {
              if (kind === 'commit') {
                setCommitOpen((open) => !open);
                return;
              }
              void actions.run(kind, strategy);
            }}
          />
        )}
      </div>

      {actions && commitOpen && (
        <CommitPopover
          message={actions.commitMessage}
          onMessageChange={actions.setCommitMessage}
          fileCount={actions.changedCount}
          running={actions.busy}
          generation={actions.commitGeneration}
          onCommit={() => {
            setCommitOpen(false);
            void actions.run('commit');
          }}
          onDismiss={() => setCommitOpen(false)}
        />
      )}

      {actions?.error && <RailError message={actions.error} />}
    </div>
  );
}

/**
 * One button, whatever the state. The caret holds the rest of the ladder —
 * every rung, disabled with its reason, so the menu's shape never changes —
 * and, when the button is Merge, the three merge strategies.
 */
function BandButton({
  primary,
  menu,
  busy,
  onRun,
}: {
  primary: BandAction | null;
  menu: BandAction[];
  busy: boolean;
  onRun: (kind: BandActionKind, strategy?: MergeStrategy) => void;
}) {
  return (
    <span className="flex shrink-0 items-center">
      {primary && (
        <Button
          size="sm"
          className={cn('rounded-r-none', busy && 'opacity-70')}
          disabled={busy}
          onClick={() => onRun(primary.kind)}
        >
          {busy ? 'Working…' : BAND_ACTION_LABELS[primary.kind]}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Other actions"
          render={
            <Button
              size="sm"
              variant={primary ? 'default' : 'outline'}
              className={cn('px-1.5', primary && 'rounded-l-none border-l')}
            />
          }
        >
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {primary?.kind === 'merge' &&
            MERGE_STRATEGIES.map((strategy) => (
              <DropdownMenuItem key={strategy.value} onClick={() => onRun('merge', strategy.value)}>
                {strategy.label}
              </DropdownMenuItem>
            ))}
          {menu.map((action) => (
            <DropdownMenuItem
              key={action.kind}
              disabled={action.disabledReason !== null}
              title={action.disabledReason ? REASON_TEXT[action.disabledReason] : undefined}
              onClick={() => {
                if (!action.disabledReason) onRun(action.kind);
              }}
            >
              {/* A disabled action says why on a second line, as the lane
                  menu does — not only in a hover title (devstation-kbf). */}
              <span className="flex min-w-0 flex-col">
                <span>{BAND_ACTION_LABELS[action.kind]}</span>
                {action.disabledReason && (
                  <span className="text-tiny tracking-tiny text-text-passive">
                    {REASON_TEXT[action.disabledReason]}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
