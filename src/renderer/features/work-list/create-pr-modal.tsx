import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { useState } from 'react';
import type { GitAiAgent } from '@shared/git-ai';
import type { LanePullRequest } from '@shared/lane-pull-requests';
import { GenerateButton, GitAiFailureNotice } from '@renderer/features/git-ai/generate-button';
import { useGitAiGeneration } from '@renderer/features/git-ai/use-git-ai';
import { selectFocusedLane } from '@renderer/features/right-rail/band/lane-band-input';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Textarea } from '@renderer/lib/ui/textarea';
import { createLanePullRequest } from './create-lane-pull-request';
import { prefillCreatePrForm, type CreatePrFormValues } from './create-pr-form';
import { describeThrownFailure } from './describe-action-failure';
import { useLanePullRequests } from './use-lane-pull-requests';

export interface CreatePrModalProps {
  workItemId: string;
  workItemName: string;
  /** The lane the PR is opened from: the one the user has focused. */
  worktreeId: string;
}

export type CreatePrResult = { number: number; url: string };

/**
 * Create PR for one lane: from its branch into its target, with the title and
 * body written here or by Git AI's Generate, prefilled from Settings › Git ›
 * AI's PR defaults. A failure keeps the form open with the reason and
 * everything the user typed.
 */
export function CreatePrModal({
  workItemId,
  workItemName,
  worktreeId,
  onSuccess,
  onClose,
}: CreatePrModalProps & BaseModalProps<CreatePrResult>) {
  const lanes = useLanePullRequests(workItemId);
  const lane = selectFocusedLane(lanes.data, worktreeId);
  const defaults = useQuery({
    queryKey: ['gitAi', 'pullRequestDefaults', workItemId, worktreeId],
    queryFn: async () => {
      const result = await rpc.gitAi.getPullRequestDefaults({ workItemId, worktreeId });
      if (!result.success) throw new Error(JSON.stringify(result.error));
      return result.data;
    },
    staleTime: 0,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create pull request</DialogTitle>
      </DialogHeader>
      {lanes.error instanceof Error && (
        <DialogContentArea>
          <p role="alert" className="text-tiny tracking-tiny text-status-err">
            {lanes.error.message}
          </p>
        </DialogContentArea>
      )}
      {defaults.error instanceof Error && (
        <DialogContentArea>
          <p role="alert" className="text-tiny tracking-tiny text-status-err">
            Could not read the PR defaults: {defaults.error.message}
          </p>
        </DialogContentArea>
      )}
      {lanes.data && !lane && (
        <DialogContentArea>
          <p role="alert" className="text-tiny tracking-tiny text-status-err">
            This branch is no longer part of the work item.
          </p>
        </DialogContentArea>
      )}
      {lane && defaults.data ? (
        <CreatePrForm
          workItemId={workItemId}
          workItemName={workItemName}
          lane={lane}
          agent={defaults.data.agent}
          initial={prefillCreatePrForm({
            workItemName,
            lane,
            prDefaults: defaults.data.prDefaults,
            template: defaults.data.template,
          })}
          onCreated={onSuccess}
          onCancel={onClose}
        />
      ) : (
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

function CreatePrForm({
  workItemId,
  workItemName,
  lane,
  agent,
  initial,
  onCreated,
  onCancel,
}: {
  workItemId: string;
  workItemName: string;
  lane: LanePullRequest;
  /** Settings › Git › AI's agent for this repository. */
  agent: GitAiAgent;
  initial: CreatePrFormValues;
  onCreated: (result: CreatePrResult) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [draft, setDraft] = useState(initial.draft);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useGitAiGeneration(
    (requestId) =>
      rpc.gitAi.generatePullRequest({ workItemId, worktreeId: lane.worktreeId, requestId }),
    (generated) => {
      setTitle(generated.title);
      setBody(generated.body);
    }
  );
  const locked = creating || generation.generating;

  const submit = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await createLanePullRequest(
        { workItemId, workItemName, worktreeId: lane.worktreeId, title, body, draft },
        queryClient
      );
      if (!created.success) {
        setError(created.error);
        return;
      }
      toast({
        title: `Opened pull request #${created.data.number}`,
        description: `${initial.head} → ${initial.base}`,
        action: { label: 'Open', onClick: () => void rpc.app.openExternal(created.data.url) },
      });
      if (initial.openAfterCreate) void rpc.app.openExternal(created.data.url);
      onCreated(created.data);
    } catch (thrown) {
      setError(describeThrownFailure('Create pull request', thrown));
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <DialogContentArea className="gap-3">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-tiny tracking-tiny text-text-muted">
          <GitBranch className="size-icon-xs shrink-0" />
          <span aria-label="Head branch" className="min-w-0 truncate">
            {initial.head ?? 'Detached HEAD'}
          </span>
          <span className="shrink-0 text-text-passive">into</span>
          <span aria-label="Base branch" className="min-w-0 truncate">
            {initial.base ?? 'No target'}
          </span>
        </div>
        {lane.targetError && (
          <p role="alert" className="text-tiny tracking-tiny text-status-err">
            {lane.targetError}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-pr-title">Title</Label>
          <Input
            id="create-pr-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={locked}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="create-pr-body">Description</Label>
            <GenerateButton
              agent={agent}
              generating={generation.generating}
              onGenerate={generation.start}
              onCancel={generation.cancel}
            />
          </div>
          <Textarea
            id="create-pr-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="What this pull request changes, and why"
            className="max-h-64 min-h-24"
            disabled={locked}
          />
        </div>
        {generation.failure && (
          <GitAiFailureNotice failure={generation.failure} onDismiss={generation.dismissFailure} />
        )}
        <Label>
          <Checkbox
            checked={draft}
            onCheckedChange={(checked) => setDraft(checked)}
            disabled={locked}
          />
          Create as draft
        </Label>
        {error && (
          <p role="alert" className="text-tiny tracking-tiny text-status-err">
            {error}
          </p>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={creating}>
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={locked || !title.trim() || initial.base === null}
        >
          {creating ? 'Creating…' : 'Create pull request'}
        </Button>
      </DialogFooter>
    </>
  );
}
