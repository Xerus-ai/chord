import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useRepos } from '@renderer/lib/hooks/use-repos';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { SettingRow } from '../components/SettingRow';
import { notifyReposChanged } from '../create-repository';
import {
  ARCHIVE_REPOSITORY_TITLE,
  UNARCHIVE_REPOSITORY_TITLE,
  useSetRepositoryArchived,
} from '../use-archive-repository';

/**
 * Repo › Manage (devstation-ec3h): archive and remove, on the repository's
 * own page now that the settings rail opens it directly. Same rules as the
 * Repositories list: archive hides it from pickers and keeps its work items;
 * remove is only offered when nothing points at it.
 */
export function RepoManageSection({
  repoId,
  onRemoved,
}: {
  repoId: string;
  onRemoved: () => void;
}) {
  const { repos } = useRepos({ includeArchived: true });
  const repo = repos.find((entry) => entry.id === repoId);
  const { setRepositoryArchived, busyRepoId } = useSetRepositoryArchived();
  const [removing, setRemoving] = useState(false);

  const remove = useCallback(async () => {
    setRemoving(true);
    try {
      const result = await rpc.repos.remove(repoId);
      if (!result.success) {
        toast({
          title: result.error.message ?? 'Could not remove repository',
          variant: 'destructive',
        });
        return;
      }
      notifyReposChanged();
      onRemoved();
    } finally {
      setRemoving(false);
    }
  }, [onRemoved, repoId]);

  if (!repo) return null;
  const isArchived = repo.archivedAt !== null;
  const inUse = repo.workItemCount > 0;
  const countLabel =
    repo.workItemCount === 0
      ? 'No work items'
      : `${repo.workItemCount} work item${repo.workItemCount === 1 ? '' : 's'}`;

  return (
    <div className="flex flex-col rounded-lg border border-border-subtle bg-surface-raised px-5 py-1">
      <SettingRow
        title={isArchived ? 'Archived' : 'Archive'}
        description={
          isArchived
            ? 'Hidden from work item pickers. Its work items are untouched.'
            : 'Hide it from work item pickers. Its work items carry on untouched.'
        }
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={busyRepoId === repo.id}
            onClick={() => void setRepositoryArchived(repo.id, !isArchived)}
            title={isArchived ? UNARCHIVE_REPOSITORY_TITLE : ARCHIVE_REPOSITORY_TITLE}
          >
            {isArchived ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
            {isArchived ? 'Unarchive' : 'Archive'}
          </Button>
        }
      />
      <SettingRow
        title="Remove from Chord"
        description={
          inUse
            ? `${countLabel} still reference this repository. Archive it instead.`
            : 'The folder on disk is untouched.'
        }
        control={
          <Button
            variant="destructive"
            size="sm"
            disabled={removing || inUse}
            onClick={() => void remove()}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        }
      />
    </div>
  );
}
