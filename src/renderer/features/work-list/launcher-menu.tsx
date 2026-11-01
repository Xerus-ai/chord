import { useQuery } from '@tanstack/react-query';
import { FilePlus, GitBranchPlus, MessageSquarePlus, Plus, Settings, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { dependenciesStore } from '@renderer/lib/stores/app-state';
import { useResourceData } from '@renderer/lib/stores/use-resource';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Spinner } from '@renderer/lib/ui/spinner';
import { agentConfig } from '@renderer/utils/agentConfig';
import { describeRpcFailure, describeThrownFailure } from './describe-action-failure';
import { EndedChatsMenuSection } from './ended-chats-menu-section';
import { previewWorktreeBranch } from './launcher-branch-preview';
import type { SessionTabModel } from './session-tab-model';
import { useWorkItemBranch } from './use-work-item-branch';

/**
 * Stages of the launcher's flow. `root` lists one "New Terminal"
 * per installed shell, then the installed agents — each opens, in the focused
 * worktree, a chat or the agent's CLI in a terminal, per Settings › Open
 * agents in — then "New chat in new worktree", which drops into a provider
 * list and then title + live branch preview, and "Agent settings…". One
 * `DropdownMenu` stays open across every stage so the flow reads as a single
 * menu, not a chain of popovers.
 */
type Stage =
  | { kind: 'root' }
  | { kind: 'pick-provider'; mode: 'new-worktree' }
  | { kind: 'new-worktree-details'; providerId: AgentProviderId }
  | { kind: 'error'; message: string };

/**
 * The `+` launcher for a work item's center tab strip (T1.4). Renders its own
 * trigger and popup menu; the caller (tab strip) just drops this in and
 * receives `onOpenSession` when a chat or terminal is ready to display, or an
 * ended chat is chosen to reopen.
 */
export function LauncherMenu({
  workItemId,
  focusedWorktreeId,
  endedChats,
  onOpenSession,
  onOpenFile,
}: {
  workItemId: string;
  focusedWorktreeId: string | null;
  /** The item's ended chats, most recently active first (`listEndedChats`). */
  endedChats: readonly SessionTabModel[];
  onOpenSession: (sessionId: string) => void;
  onOpenFile?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'root' });
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const { navigate } = useNavigate();
  // Undefined until loaded: an agent row can't guess chat or terminal.
  const openAgentsIn = useAppSettingsKey('agentLaunch').value?.openAgentsIn;

  const workItemBranch = useWorkItemBranch(workItemId);
  const { data: worktreesData } = useQuery({
    queryKey: ['worktrees', 'list', workItemId],
    queryFn: async () => {
      const result = await rpc.worktrees.list(workItemId);
      if (!result.success) throw new Error(describeRpcFailure('Load worktrees', result.error));
      return result.data.worktrees;
    },
    enabled: open,
  });

  const { data: shells, error: shellsError } = useQuery({
    queryKey: ['terminal-shells'],
    queryFn: async () => {
      const result = await rpc.terminalShells.list();
      if (!result.success) throw new Error('Could not list installed shells');
      return result.data.shells;
    },
    enabled: open,
    staleTime: Infinity,
  });

  const { data: localData } = useResourceData(dependenciesStore.local);
  const visibleProviders = useMemo(() => {
    const installedIds = new Set(
      Object.entries(localData ?? {})
        .filter(([, s]) => s.status === 'available' && s.category === 'agent')
        .map(([id]) => id)
    );
    return AGENT_PROVIDERS.filter((p) => installedIds.has(p.id));
  }, [localData]);

  const existingBranches = useMemo(
    () => (worktreesData ?? []).map((w) => w.branchName).filter((b): b is string => !!b),
    [worktreesData]
  );
  const branchPreview =
    workItemBranch && stage.kind === 'new-worktree-details'
      ? previewWorktreeBranch(workItemBranch, title, existingBranches)
      : null;

  function reset() {
    setStage({ kind: 'root' });
    setTitle('');
    setPending(false);
  }

  function closeMenu() {
    setOpen(false);
    reset();
  }

  async function createChatSession(providerId: AgentProviderId, worktreeId: string | undefined) {
    setPending(true);
    try {
      const result = await rpc.agentSessions.create({
        workItemId,
        kind: 'chat',
        agentProviderId: providerId,
        worktreeId,
      });
      if (!result.success) {
        setStage({ kind: 'error', message: describeRpcFailure('Create chat', result.error) });
        return;
      }
      onOpenSession(result.data.session.id);
      closeMenu();
    } catch (e) {
      setStage({ kind: 'error', message: describeThrownFailure('Create chat', e) });
    } finally {
      setPending(false);
    }
  }

  async function createInNewWorktree(providerId: AgentProviderId) {
    setPending(true);
    try {
      const worktreeResult = await rpc.worktrees.create({
        workItemId,
        title: title.trim() || undefined,
      });
      if (!worktreeResult.success) {
        setStage({
          kind: 'error',
          message: describeRpcFailure('Create worktree', worktreeResult.error),
        });
        return;
      }
      const sessionResult = await rpc.agentSessions.create({
        workItemId,
        kind: 'chat',
        agentProviderId: providerId,
        worktreeId: worktreeResult.data.id,
      });
      if (!sessionResult.success) {
        setStage({
          kind: 'error',
          message: describeRpcFailure('Create chat', sessionResult.error),
        });
        return;
      }
      onOpenSession(sessionResult.data.session.id);
      closeMenu();
    } catch (e) {
      setStage({ kind: 'error', message: describeThrownFailure('Create worktree', e) });
    } finally {
      setPending(false);
    }
  }

  /** The agent's own CLI in a terminal (Settings › Open agents in › Terminal). */
  async function createAgentTerminal(providerId: AgentProviderId, worktreeId: string | undefined) {
    setPending(true);
    try {
      const result = await rpc.agentSessions.createTerminal({
        workItemId,
        agentProviderId: providerId,
        worktreeId,
      });
      if (!result.success) {
        setStage({ kind: 'error', message: describeRpcFailure('Open terminal', result.error) });
        return;
      }
      onOpenSession(result.data.session.id);
      closeMenu();
    } catch (e) {
      setStage({ kind: 'error', message: describeThrownFailure('Open terminal', e) });
    } finally {
      setPending(false);
    }
  }

  function openAgent(providerId: AgentProviderId) {
    const worktreeId = focusedWorktreeId ?? undefined;
    if (openAgentsIn === 'terminal') void createAgentTerminal(providerId, worktreeId);
    else void createChatSession(providerId, worktreeId);
  }

  async function createTerminal(shell: string) {
    setPending(true);
    try {
      const result = await rpc.agentSessions.createShellTerminal({
        workItemId,
        shell,
        worktreeId: focusedWorktreeId ?? undefined,
      });
      if (!result.success) {
        setStage({ kind: 'error', message: describeRpcFailure('Create terminal', result.error) });
        return;
      }
      onOpenSession(result.data.session.id);
      closeMenu();
    } catch (e) {
      setStage({ kind: 'error', message: describeThrownFailure('Create terminal', e) });
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DropdownMenuTrigger
        aria-label="New session"
        title="New session"
        className="ml-0.5 flex size-[26px] shrink-0 cursor-pointer items-center justify-center self-center rounded-md border-none bg-transparent text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <Plus className="size-icon-md" strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max min-w-56 whitespace-nowrap">
        {stage.kind === 'root' && (
          <>
            {shellsError ? (
              <p className="px-2 py-1.5 text-tiny tracking-tiny text-status-err">
                {shellsError.message}
              </p>
            ) : shells === undefined ? (
              <div className="flex items-center gap-2 px-2 py-1.5 text-tiny tracking-tiny text-text-muted">
                <Spinner size="sm" className="h-3.5 w-3.5" />
                Finding shells…
              </div>
            ) : (
              shells.map((shell) => (
                <DropdownMenuItem
                  key={shell.id}
                  closeOnClick={false}
                  disabled={pending}
                  onClick={() => void createTerminal(shell.id)}
                >
                  <Terminal className="h-3.5 w-3.5" />
                  New Terminal: {shell.label}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            {visibleProviders.length === 0 ? (
              <div className="px-2 py-1.5 text-tiny tracking-tiny text-text-muted">
                No agents installed
              </div>
            ) : (
              visibleProviders.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  closeOnClick={false}
                  disabled={pending || openAgentsIn === undefined}
                  title={
                    openAgentsIn === 'terminal'
                      ? `Open ${p.name} in a terminal`
                      : `Start a chat with ${p.name}`
                  }
                  onClick={() => openAgent(p.id)}
                >
                  <AgentLogo
                    logo={agentConfig[p.id].logo}
                    alt={agentConfig[p.id].alt}
                    isSvg={agentConfig[p.id].isSvg}
                    invertInDark={agentConfig[p.id].invertInDark}
                    className="h-3.5 w-3.5"
                  />
                  {p.name}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => setStage({ kind: 'pick-provider', mode: 'new-worktree' })}
            >
              <GitBranchPlus className="h-3.5 w-3.5" />
              New chat in new worktree…
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                closeMenu();
                navigate('settings', { tab: 'clis-models', card: 'agent-launch' });
              }}
            >
              <Settings className="h-3.5 w-3.5" />
              Agent settings…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!onOpenFile}
              onClick={() => {
                onOpenFile?.();
                closeMenu();
              }}
            >
              <FilePlus className="h-3.5 w-3.5" />
              Open file…
            </DropdownMenuItem>
            <EndedChatsMenuSection
              chats={endedChats}
              onOpen={(sessionId) => {
                onOpenSession(sessionId);
                closeMenu();
              }}
            />
          </>
        )}

        {stage.kind === 'pick-provider' &&
          (visibleProviders.length === 0 ? (
            <div className="px-2 py-1.5 text-tiny tracking-tiny text-text-muted">
              No agents installed
            </div>
          ) : (
            visibleProviders.map((p) => (
              <DropdownMenuItem
                key={p.id}
                closeOnClick={false}
                disabled={pending}
                onClick={() => setStage({ kind: 'new-worktree-details', providerId: p.id })}
              >
                {pending ? <Spinner size="sm" className="h-3.5 w-3.5" /> : null}
                {p.name}
              </DropdownMenuItem>
            ))
          ))}

        {stage.kind === 'new-worktree-details' && (
          <div className="flex flex-col gap-2 px-2 py-1.5">
            <input
              autoFocus
              type="text"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-body tracking-body text-text outline-none"
            />
            <p className="text-tiny tracking-tiny text-text-muted">
              {branchPreview && workItemBranch
                ? `${branchPreview}, off ${workItemBranch}`
                : 'Resolving base branch…'}
            </p>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={pending || !workItemBranch}
              onClick={() => void createInNewWorktree(stage.providerId)}
            >
              {pending ? (
                <Spinner size="sm" className="h-3.5 w-3.5" />
              ) : (
                <MessageSquarePlus className="h-3.5 w-3.5" />
              )}
              Create
            </DropdownMenuItem>
          </div>
        )}

        {stage.kind === 'error' && (
          <div className="flex flex-col gap-2 px-2 py-1.5">
            <p className="text-tiny tracking-tiny text-status-err">{stage.message}</p>
            <DropdownMenuItem closeOnClick={false} onClick={() => setStage({ kind: 'root' })}>
              Back
            </DropdownMenuItem>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
