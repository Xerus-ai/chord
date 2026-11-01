import { useQuery } from '@tanstack/react-query';
import { useCloudGitState } from '@renderer/features/cloud-source/use-cloud-git-state';
import { cloudApi } from '@renderer/lib/cloud-api';
import { cloudDiffContent } from './cloud-diff-content';
import { DiffBody } from './diff-body';

/**
 * A teammate's diff of one file of the owner's pushed snapshot. Contents load
 * per file, keyed by the snapshot version, so a new push refetches the open
 * file; what shows when they can't is `cloudDiffContent`'s.
 */
export function CloudDiff({ workItemId, filePath }: { workItemId: string; filePath: string }) {
  const gitState = useCloudGitState(workItemId);
  const snapshot = gitState.data;
  const meta = snapshot?.files.find((file) => file.path === filePath);
  const contentAvailable = meta !== undefined && !meta.content_omitted;

  const { data, isPending, error } = useQuery({
    queryKey: ['cloudGitFile', workItemId, snapshot?.version ?? null, filePath],
    queryFn: () => cloudApi.getGitStateFile(workItemId, filePath),
    enabled: contentAvailable,
  });

  return (
    <DiffBody
      filePath={filePath}
      stats={meta ? { added: meta.additions, removed: meta.deletions } : null}
      content={
        // Until the snapshot answers, no file is known to be missing from it.
        gitState.error
          ? { kind: 'failed' }
          : snapshot === undefined
            ? { kind: 'loading' }
            : cloudDiffContent({ meta, pending: isPending, error, data })
      }
    />
  );
}
