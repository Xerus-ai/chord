import { Link2, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { RepoRow } from '@main/db/schema-work-items';
import {
  buildCreateWorkItemArgs,
  toTicketLink,
} from '@renderer/features/create-work-item/create-target';
import { resolveSmartField } from '@renderer/features/create-work-item/smart-resolve';
import { REPOS_CHANGED_EVENT } from '@renderer/features/settings/create-repository';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { AgentPillSelector } from '@renderer/features/work-list/agent-pill-selector';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { describeRpcFailure, describeThrownFailure } from './describe-action-failure';
import { RepoSelector, useAddRepoFromFolder, type RepoPickerRow } from './repo-selector';
import { SlashCommandMenu } from './slash-command-menu';

interface CreateWorkItemInputProps {
  onCreated: (item: { id: string; name: string }) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function CreateWorkItemInput({
  onCreated,
  inputRef: externalRef,
}: CreateWorkItemInputProps) {
  const [name, setName] = useState('');
  // The picker only holds a value once the user overrides it; until then the
  // pill reflects the `defaultAgent` setting rather than a literal of its own.
  const { value: defaultAgent } = useAppSettingsKey('defaultAgent');
  const [agentOverride, setAgentOverride] = useState<AgentProviderId | null>(null);
  const agent = agentOverride ?? (isValidProviderId(defaultAgent) ? defaultAgent : null);
  const [repos, setRepos] = useState<RepoPickerRow[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [ticketLink, setTicketLink] = useState('');
  const [showTicket, setShowTicket] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = () =>
      rpc.repos
        .getAll()
        // getAll only ever resolves Ok — a real failure arrives as a rejected
        // IPC promise, so the catch is the whole error path.
        .then((result) => {
          setRepos(result.data.repos);
          if (result.data.repos.length > 0) setSelectedRepoId(result.data.repos[0]!.id);
        })
        .catch((e: unknown) => setError(describeThrownFailure('Load repositories', e)));

    void load();
    // A repository can appear from outside this surface — the newRepository
    // shortcut works from anywhere, including while this is open.
    const handler = () => void load();
    window.addEventListener(REPOS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(REPOS_CHANGED_EVENT, handler);
  }, []);

  const handleRepoAdded = useCallback((repo: RepoRow) => {
    setRepos((prev) => [...prev, repo]);
    setSelectedRepoId(repo.id);
  }, []);
  const handleBrowseRepo = useAddRepoFromFolder({
    onRepoAdded: handleRepoAdded,
    onError: setError,
  });

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // The ticket field is read by the create dialog's rules, and the ticket
    // travels in the create request itself — written with the item, or not
    // at all.
    const trimmedTicket = ticketLink.trim();
    const ticketResolution = trimmedTicket ? resolveSmartField(trimmedTicket) : null;
    const ticket = ticketResolution ? toTicketLink(ticketResolution) : null;
    if (trimmedTicket && !ticket) {
      setError('The ticket link is not a GitHub issue, Linear issue, or Jira issue');
      return;
    }
    const request = buildCreateWorkItemArgs(
      { kind: 'new_lane', name: trimmed, ticket, notice: null },
      {
        id: crypto.randomUUID(),
        repoId: selectedRepoId ?? undefined,
        // null while the setting is still loading — main then applies
        // `defaultAgent` itself, so the outcome is the same either way.
        agentProvider: agent ?? undefined,
      }
    );
    if (!request) throw new Error('A named work item always has a create request');

    setCreating(true);
    setError(null);

    try {
      const result = await rpc.workItems.create(request);

      if (!result.success) {
        setError(describeRpcFailure('Create work item', result.error));
        return;
      }

      const itemId = result.data.item.id;

      // The name is a name, not a prompt — the agent starts on the user's
      // first real chat message (send-to-agent gates on the worktree being
      // ready anyway, and it usually isn't yet at this instant).
      onCreated({ id: itemId, name: result.data.item.name });
      setName('');
      setTicketLink('');
      setShowTicket(false);
      setSlashMenuOpen(false);
    } catch (e) {
      setError(describeThrownFailure('Create work item', e));
    } finally {
      setCreating(false);
    }
  }, [name, selectedRepoId, ticketLink, agent, onCreated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  // The `/` affordance in the controls bar promised a command menu that was
  // never mounted here. Same menu the chat composer uses, driven off the same
  // "starts with a slash and has no space yet" rule; the agent executes a
  // leading slash command as the work item's opening message.
  const handleSlashSelect = useCallback((command: string) => {
    setName(command + ' ');
    setSlashMenuOpen(false);
    inputRef.current?.focus();
  }, []);

  // A repository is not a preference here — `createWorkItem` has nowhere to
  // resolve `repoPath` from without one, and `repoPath` is the agent session's
  // working directory. Gating send says so before the click instead of after it.
  const hasRepo = selectedRepoId !== null;
  const canSubmit = name.trim().length > 0 && !creating && hasRepo;

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-surface-raised shadow-sm transition-all duration-200',
        error ? 'border-status-err/30' : 'border-border',
        'focus-within:border-border-strong focus-within:shadow-[0_0_0_3px_var(--focus-ring)]'
      )}
    >
      {agent && (
        <SlashCommandMenu
          query={name}
          providerId={agent}
          visible={slashMenuOpen}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenuOpen(false)}
          placement="below"
        />
      )}

      {/* Input area */}
      <div className="px-4 pt-4 pb-3">
        <input
          ref={(el) => {
            inputRef.current = el;
            if (externalRef && 'current' in externalRef) {
              (externalRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
            }
          }}
          className="w-full bg-transparent text-body tracking-body text-text outline-none placeholder:text-text-passive"
          placeholder="What do you want to work on?"
          value={name}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            setSlashMenuOpen(v.startsWith('/') && !v.includes(' '));
            setError(null);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Ticket link (inline, expandable). Collapsed rows are hidden from the
          keyboard too — `grid-rows-[0fr]` only hides them from the eye, so
          tabbing out of the composer used to land in an invisible field. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200',
          showTicket ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3">
            <input
              className="w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-tiny tracking-tiny text-text outline-none placeholder:text-text-passive transition-colors focus:border-border-strong"
              placeholder="Paste Jira, Linear, or GitHub issue URL"
              value={ticketLink}
              disabled={!showTicket}
              onChange={(e) => setTicketLink(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2">
        {agent && <AgentPillSelector selected={agent} onSelect={setAgentOverride} />}

        {/* Shared with the create modal: with no repositories yet this renders
            "Add repository" rather than nothing, which is what used to leave a
            fresh install with no way to satisfy the repository requirement. */}
        <RepoSelector
          repos={repos}
          selectedRepoId={selectedRepoId}
          onSelect={setSelectedRepoId}
          onBrowse={handleBrowseRepo}
          placement="below"
        />
        {repos.length === 0 && (
          <span className="text-tiny tracking-tiny text-text-passive">
            Required to create a work item
          </span>
        )}

        {/* Ticket toggle */}
        <button
          type="button"
          onClick={() => setShowTicket(!showTicket)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
            showTicket || ticketLink
              ? 'text-text bg-selected-bg'
              : 'text-text-passive hover:text-text-muted hover:bg-surface-inset'
          )}
          title="Link ticket"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>

        {/* Slash hint */}
        <span className="rounded bg-surface-inset px-1 py-0.5 font-mono text-micro tracking-micro text-text-passive">
          /
        </span>

        <div className="flex-1" />

        {/* Error */}
        {error && (
          <span role="alert" className="mr-2 text-tiny tracking-tiny text-status-err">
            {error}
          </span>
        )}

        {/* Send */}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          title={hasRepo ? undefined : 'Add a repository first'}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150',
            canSubmit
              ? 'bg-action-bg text-action-fg cursor-pointer hover:bg-action-bg-hover hover:scale-105 active:scale-95'
              : 'bg-action-bg-disabled text-action-fg-disabled cursor-default'
          )}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
