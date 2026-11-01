import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ArtifactLoadError } from '@renderer/features/artifacts/artifact-load-error';
import { ArtifactFileView } from '@renderer/features/artifacts/file/artifact-file-view';
import { PageFrame } from '@renderer/features/artifacts/page/page-frame';
import { usePreparedPage } from '@renderer/features/artifacts/page/use-prepared-page';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import type { PathFormat } from './path-tab-modes';
import { useRepoFileChanges } from './use-repo-file-changes';

const CENTERED = 'flex flex-1 items-center justify-center text-body tracking-body';

function RepoPagePreview({
  workItemId,
  worktreeId,
  filePath,
}: {
  workItemId: string;
  worktreeId?: string;
  filePath: string;
}) {
  const { effectiveTheme } = useTheme();
  const { url, loading, error, reload } = usePreparedPage(
    { kind: 'repo-file', workItemId, filePath, worktreeId },
    effectiveTheme
  );
  useRepoFileChanges({ workItemId, worktreeId, filePath, onChange: reload });
  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactLoadError message={error} onRetry={reload} />
      </div>
    );
  }
  if (loading || !url)
    return <div className={`${CENTERED} text-text-passive`}>Preparing page…</div>;
  return (
    <div data-testid="repo-page-preview" className="relative flex min-h-0 flex-1 flex-col">
      <PageFrame
        key={url}
        url={url}
        theme={effectiveTheme}
        title={filePath}
        sizing="fill"
        onNavigationBlocked={reload}
      />
    </div>
  );
}

function RepoMarkdownPreview({
  workItemId,
  worktreeId,
  filePath,
}: {
  workItemId: string;
  worktreeId?: string;
  filePath: string;
}) {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['workItem', 'fileContent', workItemId, filePath, worktreeId],
    queryFn: async () => {
      const result = await rpc.workItems.readRepoFile(workItemId, filePath, worktreeId);
      if (!result.success) throw new Error(`Could not read ${filePath}: ${result.error.type}`);
      return result.data;
    },
  });
  const refetchContent = useCallback(() => void refetch(), [refetch]);
  useRepoFileChanges({ workItemId, worktreeId, filePath, onChange: refetchContent });
  if (isPending) return <div className={`${CENTERED} text-text-passive`}>Loading…</div>;
  if (error) {
    return <ArtifactLoadError message={String(error.message)} onRetry={() => void refetch()} />;
  }
  return (
    <div data-testid="repo-markdown-preview" className="min-h-0 flex-1 overflow-auto px-10 py-8">
      <MarkdownRenderer content={data.content} variant="full" />
    </div>
  );
}

function RepoBinaryPreview({
  workItemId,
  worktreeId,
  filePath,
}: {
  workItemId: string;
  worktreeId?: string;
  filePath: string;
}) {
  // A change on disk bumps the key, and the viewer reads the file again.
  const [readCount, setReadCount] = useState(0);
  const readAgain = useCallback(() => setReadCount((count) => count + 1), []);
  useRepoFileChanges({ workItemId, worktreeId, filePath, onChange: readAgain });
  return (
    <ArtifactFileView
      target={{ source: 'repo', workItemId, filePath, worktreeId }}
      title={filePath}
      reloadKey={`${filePath}#${readCount}`}
    />
  );
}

/**
 * Preview for a repo file that is no artifact (design 2026-09-26 §3): a page
 * in its frame, markdown rendered read-only, a binary in the file viewers. The
 * other formats have no preview — `resolvePathModes` never offers one.
 */
export function RepoFilePreview({
  workItemId,
  worktreeId,
  filePath,
  format,
}: {
  workItemId: string;
  worktreeId?: string;
  filePath: string;
  format: PathFormat;
}) {
  switch (format) {
    case 'page':
      return (
        <RepoPagePreview workItemId={workItemId} worktreeId={worktreeId} filePath={filePath} />
      );
    case 'markdown':
      return (
        <RepoMarkdownPreview workItemId={workItemId} worktreeId={worktreeId} filePath={filePath} />
      );
    case 'binary':
      return (
        <RepoBinaryPreview workItemId={workItemId} worktreeId={worktreeId} filePath={filePath} />
      );
    case 'document':
    case 'source':
      throw new Error(`A ${format} repo file has no preview`);
  }
}
