import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, GitPullRequest, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';
import type { LaneChecksState } from '@shared/lane-pull-requests';
import { pickLaneSession, switchToSession } from '@renderer/features/right-rail/focus-lane';
import {
  useFocusedWorktreeId,
  useLiveWorktrees,
} from '@renderer/features/right-rail/use-focused-worktree';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { statusTextClass, type StatusSignal } from '@renderer/lib/status-dot';
import { cn } from '@renderer/utils/utils';
import { listLanePrChips, type LanePrChip } from './header-lane-prs';
import { useLanePullRequests } from './use-lane-pull-requests';
import { HEADER_CHIP } from './work-item-header';

const STATE_TEXT: Record<LanePrChip['state'], { label: string; signal: StatusSignal }> = {
  open: { label: 'Open', signal: 'success' },
  draft: { label: 'Draft', signal: 'neutral' },
  merged: { label: 'Merged', signal: 'merged' },
  closed: { label: 'Closed', signal: 'danger' },
};

const CHECKS: Record<
  Exclude<LaneChecksState, 'none'>,
  { label: string; signal: StatusSignal; Icon: ComponentType<{ className?: string }> }
> = {
  passing: { label: 'checks passing', signal: 'success', Icon: CheckCircle2 },
  failing: { label: 'checks failing', signal: 'danger', Icon: XCircle },
  pending: { label: 'checks running', signal: 'running', Icon: CircleDashed },
};

/**
 * Every lane's pull request in the work item header (plan 2026-09-26 P8):
 * number, state and checks. A chip focuses its lane, which is what moves the
 * band, Checks and Merge onto that PR. The owner's layout is keyed by the work
 * item, so the focused lane is read the way the rail reads it.
 */
export function HeaderLanePrChips({ workItemId }: { workItemId: string }) {
  const lanes = useLanePullRequests(workItemId);
  const focusedWorktreeId = useFocusedWorktreeId(workItemId, workItemId);
  const worktrees = useLiveWorktrees(workItemId);
  const { data: sessions } = useQuery({
    queryKey: ['agentSessions', workItemId],
    queryFn: async () => (await rpc.agentSessions.getAll(workItemId)).data.sessions,
    refetchInterval: 5000,
  });

  const chips = listLanePrChips(lanes.data?.lanes ?? [], focusedWorktreeId);
  if (chips.length === 0) return null;

  const focusLane = (chip: LanePrChip) => {
    const sessionId = pickLaneSession(chip.worktreeId, worktrees, sessions ?? []);
    if (sessionId) {
      switchToSession(sessionId);
      return;
    }
    toast({
      title: `Nothing is open in ${chip.branchName ?? 'this branch'}`,
      description: 'Start a session in that branch to show its pull request in the rail.',
    });
  };

  return (
    <>
      {chips.map((chip) => {
        const state = STATE_TEXT[chip.state];
        const checks = chip.checks === 'none' ? null : CHECKS[chip.checks];
        const branch = chip.branchName ?? 'detached HEAD';
        return (
          <button
            key={chip.worktreeId}
            type="button"
            onClick={() => focusLane(chip)}
            aria-label={`PR #${chip.number} · ${branch}`}
            aria-pressed={chip.focused}
            title={`PR #${chip.number} on ${branch}: ${state.label}${checks ? `, ${checks.label}` : ''}`}
            className={cn(
              HEADER_CHIP,
              'cursor-pointer tabular-nums transition-colors hover:border-border-strong',
              chip.focused && 'border-border-strong text-text'
            )}
          >
            <GitPullRequest className={cn('h-[11px] w-[11px]', statusTextClass(state.signal))} />
            <span>#{chip.number}</span>
            {checks && (
              <checks.Icon className={cn('h-[11px] w-[11px]', statusTextClass(checks.signal))} />
            )}
          </button>
        );
      })}
    </>
  );
}
