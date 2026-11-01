import { useQuery } from '@tanstack/react-query';
import { File, GitCommit, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { CommitFile } from '@shared/git';
import { useWorkItems } from '@renderer/lib/hooks/use-work-items';
import { rpc } from '@renderer/lib/ipc';
import { describeRpcFailure } from './describe-action-failure';
import { detectLanguage, MonacoDiffMount } from './monaco-diff-mount';

function PanelMessage({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div
      className={`flex flex-1 items-center justify-center gap-2 text-body tracking-body ${tone === 'error' ? 'text-status-err' : 'text-text-passive'}`}
    >
      {children}
    </div>
  );
}

function CommitFileList({
  files,
  selectedPath,
  onSelect,
}: {
  files: readonly CommitFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-raised py-1">
      {files.map((file) => (
        <button
          key={file.path}
          onClick={() => onSelect(file.path)}
          title={`${file.path} (${file.status})`}
          className={`flex cursor-pointer items-center gap-2 border-none px-3 py-1.5 text-left text-tiny tracking-tiny transition-colors ${
            file.path === selectedPath
              ? 'bg-surface-inset text-text'
              : 'bg-transparent text-text-muted hover:bg-surface-inset hover:text-text'
          }`}
        >
          <File className="h-3 w-3 shrink-0 text-text-passive" />
          <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
          <span className="shrink-0 font-mono">
            <span className="text-status-ok">+{file.additions}</span>{' '}
            <span className="text-status-err">-{file.deletions}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function CommitFileDiff({
  projectId,
  worktreeId,
  sha,
  filePath,
}: {
  projectId: string;
  worktreeId: string;
  sha: string;
  filePath: string;
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['git', 'commitFileDiff', worktreeId, sha, filePath],
    queryFn: async () => {
      const result = await rpc.git.getCommitFileDiff(projectId, worktreeId, sha, filePath);
      if (!result.success) throw new Error(describeRpcFailure('Load diff', result.error));
      return result.data.diff;
    },
    // A commit never changes; its diff is fetched once per file.
    staleTime: Infinity,
  });

  if (isPending) {
    return (
      <PanelMessage>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading diff…
      </PanelMessage>
    );
  }
  if (error) return <PanelMessage tone="error">{error.message}</PanelMessage>;
  if (data.isBinary) return <PanelMessage>Binary file — no text diff to show</PanelMessage>;
  return (
    <div className="flex-1 overflow-hidden">
      <MonacoDiffMount
        original={data.originalContent ?? ''}
        modified={data.modifiedContent ?? ''}
        language={detectLanguage(filePath)}
        renderSideBySide
      />
    </div>
  );
}

function CommitPanelBody({
  projectId,
  worktreeId,
  sha,
}: {
  projectId: string;
  worktreeId: string;
  sha: string;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const {
    data: files,
    isPending,
    error,
  } = useQuery({
    queryKey: ['git', 'commitFiles', worktreeId, sha],
    queryFn: async () => {
      const result = await rpc.git.getCommitFiles(projectId, worktreeId, sha);
      if (!result.success) throw new Error(describeRpcFailure('List commit files', result.error));
      return result.data.files;
    },
    staleTime: Infinity,
  });

  const activePath = selectedPath ?? files?.[0]?.path ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-5 py-2">
        <GitCommit className="h-[14px] w-[14px] text-text-passive" />
        <span className="font-mono text-tiny tracking-tiny font-medium text-text">
          {sha.slice(0, 7)}
        </span>
        {files && (
          <span className="text-tiny tracking-tiny text-text-muted">
            {files.length} {files.length === 1 ? 'file' : 'files'} changed
          </span>
        )}
      </div>
      {isPending ? (
        <PanelMessage>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading commit…
        </PanelMessage>
      ) : error ? (
        <PanelMessage tone="error">{error.message}</PanelMessage>
      ) : files.length === 0 ? (
        <PanelMessage>This commit changes no files</PanelMessage>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <CommitFileList files={files} selectedPath={activePath} onSelect={setSelectedPath} />
          {activePath && (
            <CommitFileDiff
              key={activePath}
              projectId={projectId}
              worktreeId={worktreeId}
              sha={sha}
              filePath={activePath}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A commit tab: the files the commit touched, and the selected file's diff
 * against the commit's first parent.
 *
 * `git.*` RPCs take `(projectId, workspaceId)`. `resolveWorkspace` looks the
 * workspace up by `workspaceId` alone, and `worktrees/workspace-bridge.ts`
 * registers each worktree's workspace under its worktree id, so `worktreeId`
 * is what selects the checkout; a `not_found` means that worktree's workspace
 * is not acquired (archived or not yet booted). `projectId` is the key the
 * bridge acquired it under (`repoId ?? mainRepoPath`), resolved in main by
 * `worktrees.getProjectId` since only git knows a repo-less item's main repo.
 */
export function CommitPanel({
  workItemId,
  worktreeId,
  sha,
}: {
  workItemId: string;
  worktreeId: string;
  sha: string;
}) {
  const { items, isLoading } = useWorkItems();
  const workItem = items.find((w) => w.id === workItemId);
  const projectIdQuery = useQuery({
    queryKey: ['worktrees', 'projectId', worktreeId],
    queryFn: async () => {
      const result = await rpc.worktrees.getProjectId(worktreeId);
      if (!result.success) throw new Error(describeRpcFailure('Resolve project', result.error));
      return result.data.projectId;
    },
    enabled: !!workItem,
    staleTime: Infinity,
  });
  if (!workItem) {
    return isLoading ? (
      <PanelMessage>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading commit…
      </PanelMessage>
    ) : (
      <PanelMessage tone="error">This work item is not available on this device</PanelMessage>
    );
  }
  if (projectIdQuery.isPending) {
    return (
      <PanelMessage>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading commit…
      </PanelMessage>
    );
  }
  if (projectIdQuery.error) {
    return <PanelMessage tone="error">{projectIdQuery.error.message}</PanelMessage>;
  }
  return <CommitPanelBody projectId={projectIdQuery.data} worktreeId={worktreeId} sha={sha} />;
}
