import { useCallback, useEffect } from 'react';
import type { AgentSessionRow, WorkItemRow } from '@main/db/schema-work-items';
import { useFocusedWorktreeId } from '@renderer/features/right-rail/use-focused-worktree';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import type { CenterTab } from './center-tab';
import { openCenterTab } from './center-tabs-store';
import { isGitAction, useGitActions } from './use-git-actions';

/**
 * The command palette's work-item actions, which act on this machine: switch
 * or focus a chat, stop the agent, run a git action, open a terminal. Only the
 * owner's view mounts this hook, and it listens only with
 * `capabilities.paletteActions`; none of these listeners exist while a cloud
 * item is on screen.
 */
export function useOwnerPaletteListeners({
  item,
  sessions,
  loadSessions,
  enabled,
}: {
  item: WorkItemRow;
  sessions: AgentSessionRow[];
  loadSessions: () => void;
  /** `capabilities.paletteActions`: the palette's work-item actions are the owner's. */
  enabled: boolean;
}) {
  // The owner's centre layout is keyed by the work item, as the rail's is.
  const focusedWorktreeId = useFocusedWorktreeId(item.id, item.id);
  const runGitAction = useGitActions(item, focusedWorktreeId);

  // The shortcut opens the platform's default shell — the first one the
  // launcher lists.
  const handleCreateTerminal = useCallback(() => {
    rpc.terminalShells
      .list()
      .then((shells) => {
        const shell = shells.success ? shells.data.shells[0] : undefined;
        if (!shell) throw new Error('No installed shell was found');
        return rpc.agentSessions.createShellTerminal({ workItemId: item.id, shell: shell.id });
      })
      .then((result) => {
        if (result.success) {
          loadSessions();
          openCenterTab(item.id, { kind: 'session', sessionId: result.data.session.id });
        } else {
          log.warn('handleCreateTerminal: createTerminal failed', { error: result.error });
        }
      })
      .catch((err) => {
        log.error('handleCreateTerminal: RPC error', { error: err });
      });
  }, [item.id, loadSessions]);

  useEffect(() => {
    if (!enabled) return;
    const handleSwitchTab = (e: Event) => {
      const tab = (e as CustomEvent<CenterTab>).detail;
      if (tab) {
        openCenterTab(item.id, tab);
        if (tab.kind === 'session') loadSessions();
      }
    };
    // Targeted by a stable attribute, not by placeholder text: the old
    // `textarea[placeholder*="Mention"]` selector made focus-chat break
    // silently the moment anyone reworded the composer's placeholder. Only the
    // visible composer in the focused pane carries it; when that pane shows a
    // document or terminal instead, fall back to opening a chat thread, which
    // brings its own composer with it.
    const findComposer = () =>
      document.querySelector<HTMLTextAreaElement>('textarea[data-chord-composer]');
    const handleFocusChat = () => {
      const composer = findComposer();
      if (composer) {
        composer.focus();
        return;
      }
      // The newest chat thread, since there is no longer a Room composer to
      // fall back to. With no thread at all the pane's empty state offers the
      // launcher, and there is nothing to focus.
      const newest = sessions.filter((s) => s.kind === 'chat' && s.status !== 'done').at(-1);
      if (!newest) return;
      openCenterTab(item.id, { kind: 'session', sessionId: newest.id });
      requestAnimationFrame(() => findComposer()?.focus());
    };
    const handleStopAgent = () => {
      rpc.chatMessages.stopAgent(item.id).catch(() => {});
    };
    const handleGitAction = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (isGitAction(action)) void runGitAction(action);
    };
    const handleCreateTerminalEvent = () => handleCreateTerminal();
    window.addEventListener('chord:switch-tab', handleSwitchTab);
    window.addEventListener('chord:focus-chat', handleFocusChat);
    window.addEventListener('chord:stop-agent', handleStopAgent);
    window.addEventListener('chord:git-action', handleGitAction);
    window.addEventListener('chord:create-terminal', handleCreateTerminalEvent);
    return () => {
      window.removeEventListener('chord:switch-tab', handleSwitchTab);
      window.removeEventListener('chord:focus-chat', handleFocusChat);
      window.removeEventListener('chord:stop-agent', handleStopAgent);
      window.removeEventListener('chord:git-action', handleGitAction);
      window.removeEventListener('chord:create-terminal', handleCreateTerminalEvent);
    };
  }, [enabled, item.id, handleCreateTerminal, loadSessions, runGitAction, sessions]);
}
