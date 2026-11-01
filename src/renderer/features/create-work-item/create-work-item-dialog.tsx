import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { RepoRow } from '@main/db/schema-work-items';
import { REPOS_CHANGED_EVENT } from '@renderer/features/settings/create-repository';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { AgentPillSelector } from '@renderer/features/work-list/agent-pill-selector';
import {
  describeRpcFailure,
  describeThrownFailure,
} from '@renderer/features/work-list/describe-action-failure';
import {
  RepoSelector,
  useAddRepoFromFolder,
  type RepoPickerRow,
} from '@renderer/features/work-list/repo-selector';
import { FoldedOutput } from '@renderer/lib/components/folded-output';
import { useAutoGrow } from '@renderer/lib/hooks/use-auto-grow';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Kbd } from '@renderer/lib/ui/kbd';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { describeCreateFailure, type CreateFromPick } from './create-from-pick';
import { CreateFromPicker, PickChip } from './create-from-picker';
import { buildCreateWorkItemArgs } from './create-target';
import { BranchOffButton, CreateTargetPreview } from './create-target-preview';
import { useCreateTarget } from './use-create-target';

export type CreateWorkItemResult = { id: string; name: string };

type Props = BaseModalProps<CreateWorkItemResult> & {
  /** The repo header's plus and the dashboard prompt bar open this prefilled. */
  initialRepoId?: string;
  initialPrompt?: string;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="w-20 shrink-0 pt-2 text-tiny tracking-tiny text-text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * One dialog for every way a work item starts. The Smart field takes a name, a
 * ticket URL or key, or a PR URL and works out which it is
 * (`smart-resolve.ts`); Create from… picks an issue, a PR or a branch instead
 * (`create-from-picker.tsx`). A ticket is looked up and the item named from
 * its key and title; a PR or branch checks out its branch, unless it is
 * checked out elsewhere — then the only way on is a new lane branched off it.
 * What will be created is shown before Create (`create-target-preview.tsx`)
 * and sent as one request, ticket included. The first prompt is sent as the
 * user's own first message rather than as the item's name.
 */
export function CreateWorkItemDialog({ onSuccess, onClose, initialRepoId, initialPrompt }: Props) {
  const [smartText, setSmartText] = useState('');
  const [pick, setPick] = useState<CreateFromPick | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [repos, setRepos] = useState<RepoPickerRow[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(initialRepoId ?? null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [baseBranch, setBaseBranch] = useState('');
  const [createMore, setCreateMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What git said when Create was refused because the remote could not be asked.
  const [failureGitOutput, setFailureGitOutput] = useState<string | null>(null);
  // Set when Create was refused for a branch checked out elsewhere.
  const [failureBranchOff, setFailureBranchOff] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Chosen here so the branch previewed is the branch created (main builds it
  // from the same name and id). A new one for each item "Create more" makes.
  const [workItemId, setWorkItemId] = useState(() => crypto.randomUUID());

  const { value: defaultAgent } = useAppSettingsKey('defaultAgent');
  const [agentOverride, setAgentOverride] = useState<AgentProviderId | null>(null);
  const agent = agentOverride ?? (isValidProviderId(defaultAgent) ? defaultAgent : null);

  const smartRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(promptRef, prompt);

  const { target, branchPreview } = useCreateTarget({
    smartText,
    pick,
    repoId: selectedRepoId,
    workItemId,
  });
  // Null while a lookup is pending, a PR can't be checked out, or the branch
  // is held elsewhere: Create and Ctrl+Enter then have nothing to send.
  const request = target
    ? buildCreateWorkItemArgs(target, {
        id: workItemId,
        repoId: selectedRepoId ?? undefined,
        agentProvider: agent ?? undefined,
        baseRef: baseBranch,
      })
    : null;

  const clearError = useCallback(() => {
    setError(null);
    setFailureGitOutput(null);
    setFailureBranchOff(null);
  }, []);

  const choosePick = useCallback(
    (next: CreateFromPick | null) => {
      setPick(next);
      setPickerOpen(false);
      clearError();
    },
    [clearError]
  );
  const branchOff = useCallback(
    (branch: string) => choosePick({ kind: 'branch_off', branch }),
    [choosePick]
  );
  // A pick belongs to the repository it was listed for.
  const selectRepo = useCallback((repoId: string | null) => {
    setSelectedRepoId(repoId);
    setPick(null);
  }, []);

  useEffect(() => {
    const load = () =>
      rpc.repos
        .getAll()
        .then((result) => {
          setRepos(result.data.repos);
          setSelectedRepoId((current) => current ?? result.data.repos[0]?.id ?? null);
        })
        .catch((e: unknown) => setError(describeThrownFailure('Load repositories', e)));
    void load();
    const handler = () => void load();
    window.addEventListener(REPOS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(REPOS_CHANGED_EVENT, handler);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => smartRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleRepoAdded = useCallback(
    (repo: RepoRow) => {
      setRepos((prev) => [...prev, repo]);
      selectRepo(repo.id);
    },
    [selectRepo]
  );
  const handleBrowse = useAddRepoFromFolder({ onRepoAdded: handleRepoAdded, onError: setError });

  const handleCreate = useCallback(async () => {
    if (!request || creating) return;
    setCreating(true);
    clearError();

    try {
      const result = await rpc.workItems.create(request);

      // A refused request (a base that doesn't exist, a branch checked out
      // elsewhere, …) stays in the dialog with nothing created, so the user
      // can fix what they asked for.
      if (!result.success) {
        const failure = describeCreateFailure(result.error);
        setError(failure.message);
        setFailureGitOutput(failure.gitOutput);
        setFailureBranchOff(failure.branchOff);
        return;
      }

      const created = result.data.item;
      const opening = prompt.trim();
      if (opening) {
        // Saved at once; delivered when the lane is ready (checkout created,
        // setup finished) — the main process holds it until then.
        const sent = await rpc.chatMessages.sendToAgent({
          workItemId: created.id,
          content: opening,
        });
        if (!sent.success) {
          setError(describeRpcFailure('Send the first prompt', sent.error));
          return;
        }
      }

      if (createMore) {
        setSmartText('');
        setPick(null);
        setPrompt('');
        setWorkItemId(crypto.randomUUID());
        smartRef.current?.focus();
        return;
      }
      onSuccess({ id: created.id, name: created.name });
    } catch (e) {
      setError(describeThrownFailure('Create work item', e));
    } finally {
      setCreating(false);
    }
  }, [request, creating, clearError, prompt, createMore, onSuccess]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void handleCreate();
      }
    },
    [handleCreate]
  );

  return (
    <div className="flex flex-col" onKeyDown={handleKeyDown}>
      <div className="border-b border-border px-5 py-3 text-body tracking-body font-medium text-text">
        Create work item
      </div>

      <div className="px-5 py-2">
        <Field label="Repo">
          <RepoSelector
            repos={repos}
            selectedRepoId={selectedRepoId}
            onSelect={selectRepo}
            onBrowse={handleBrowse}
            placement="below"
          />
        </Field>

        <Field label="Name">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {pick ? (
                <PickChip pick={pick} onClear={() => choosePick(null)} />
              ) : (
                <Input
                  ref={smartRef}
                  value={smartText}
                  onChange={(event) => {
                    setSmartText(event.target.value);
                    clearError();
                  }}
                  placeholder="Type a name, a ticket key or ticket URL, or a PR URL"
                />
              )}
            </div>
            {/* Named for its action, so it never reads as the Create button. */}
            <Button
              variant="outline"
              size="sm"
              aria-expanded={pickerOpen}
              aria-label={pickerOpen ? 'Close Create from…' : 'Open Create from…'}
              onClick={() => setPickerOpen((open) => !open)}
            >
              Create from…
            </Button>
          </div>
          <CreateTargetPreview
            target={target}
            branchPreview={branchPreview}
            onBranchOff={branchOff}
          />
          {pickerOpen && <CreateFromPicker repoId={selectedRepoId} onPick={choosePick} />}
        </Field>

        <Field label="Agent">
          {agent ? (
            <AgentPillSelector selected={agent} onSelect={setAgentOverride} />
          ) : (
            <span className="text-tiny tracking-tiny text-text-passive">
              Reading your default agent…
            </span>
          )}
        </Field>

        <Field label="Prompt">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
            placeholder="What should the agent do first?"
            className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-body tracking-body text-text outline-none placeholder:text-text-passive focus-visible:border-selected-border"
          />
        </Field>

        <button
          type="button"
          onClick={() => setAdvancedOpen((prev) => !prev)}
          className="flex items-center gap-1 py-2 text-tiny tracking-tiny text-text-muted transition-colors hover:text-text"
        >
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', !advancedOpen && '-rotate-90')}
          />
          Advanced
        </button>
        {advancedOpen && (
          <Field label="Base branch">
            <Input
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              placeholder="Defaults to the remote's default branch, fetched"
            />
          </Field>
        )}
      </div>

      {error && (
        <div className="flex flex-col items-start gap-1.5 border-t border-border px-5 py-2">
          <span role="alert" className="text-tiny tracking-tiny text-status-err">
            {error}
          </span>
          {failureGitOutput && <FoldedOutput label="Show git output" output={failureGitOutput} />}
          {failureBranchOff && (
            <BranchOffButton branch={failureBranchOff} onBranchOff={branchOff} />
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-tiny tracking-tiny text-text-muted">
          <Switch checked={createMore} onCheckedChange={setCreateMore} />
          Create more
        </label>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={creating || !request} onClick={() => void handleCreate()}>
            Create
            <Kbd>Ctrl ↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}
