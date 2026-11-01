import { Archive, ArchiveRestore, FolderOpen, FolderPlus, Settings, Trash2 } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useRepos, type RepoRecord } from '@renderer/lib/hooks/use-repos';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import {
  addExistingRepositoryFromFolder,
  createRepositoryFromFolder,
  notifyReposChanged,
} from '../create-repository';
import {
  ARCHIVE_REPOSITORY_TITLE,
  UNARCHIVE_REPOSITORY_TITLE,
  useSetRepositoryArchived,
} from '../use-archive-repository';

/**
 * Repository management.
 *
 * Archive is the everyday action for a repo you are done with: it hides it from
 * the create-a-work-item pickers but keeps the row, which is what
 * `work_items.repo_id` resolves against — including the repo-level trust
 * decision — so its work items carry on untouched.
 *
 * Deleting is only offered for a repo nothing points at. The main process
 * enforces that too; this UI just explains the rule before the user hits it,
 * which is why the work item count is on every row.
 */
const RepositoriesCard: React.FC = () => {
  const { repos, isLoading, error } = useRepos({ includeArchived: true });
  const { setRepositoryArchived, busyRepoId } = useSetRepositoryArchived();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { setParams } = useParams('settings');
  const openRepoSettings = useCallback(
    (repoId: string) => setParams({ tab: 'repository', card: undefined, repoId }),
    [setParams]
  );

  const remove = useCallback(async (repo: RepoRecord) => {
    setRemovingId(repo.id);
    try {
      const result = await rpc.repos.remove(repo.id);
      if (!result.success) {
        toast({
          title: result.error.message ?? 'Could not remove repository',
          variant: 'destructive',
        });
        return;
      }
      notifyReposChanged();
    } finally {
      setRemovingId(null);
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="text-tiny tracking-tiny text-status-err">
          Could not load repositories: {error.message}
        </p>
      ) : isLoading ? (
        <p className="text-tiny tracking-tiny text-text-passive">Loading repositories…</p>
      ) : repos.length === 0 ? (
        <p className="text-tiny tracking-tiny text-text-passive">
          No repositories yet. Add one to start creating work items.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {repos.map((repo) => {
            const isArchived = repo.archivedAt !== null;
            const inUse = repo.workItemCount > 0;
            return (
              <li
                key={repo.id}
                className={cn(
                  'flex items-center gap-3 rounded-[var(--radius-sm)] border border-border-subtle px-3 py-2',
                  isArchived && 'opacity-60'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-small tracking-small text-text">
                      {repo.alias}
                    </span>
                    {isArchived && (
                      <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-inset px-1.5 py-0.5 text-micro tracking-micro uppercase text-text-passive">
                        Archived
                      </span>
                    )}
                  </div>
                  <div
                    className="truncate font-mono text-tiny tracking-tiny text-text-passive"
                    title={repo.path}
                  >
                    {repo.path}
                  </div>
                </div>

                <span className="shrink-0 text-tiny tracking-tiny text-text-passive">
                  {repo.workItemCount === 0
                    ? 'No work items'
                    : `${repo.workItemCount} work item${repo.workItemCount === 1 ? '' : 's'}`}
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openRepoSettings(repo.id)}
                  title={`Settings for ${repo.alias}: base branch, scripts, files to copy, trust`}
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyRepoId === repo.id}
                  onClick={() => void setRepositoryArchived(repo.id, !isArchived)}
                  title={isArchived ? UNARCHIVE_REPOSITORY_TITLE : ARCHIVE_REPOSITORY_TITLE}
                >
                  {isArchived ? (
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={removingId === repo.id || inUse}
                  onClick={() => void remove(repo)}
                  title={
                    inUse
                      ? `${repo.workItemCount} work item${repo.workItemCount === 1 ? '' : 's'} still reference this repository. Archive it instead.`
                      : 'Remove this repository from Chord. The folder on disk is untouched.'
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void addExistingRepositoryFromFolder()}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          Add existing
        </Button>
        <Button variant="outline" size="sm" onClick={() => void createRepositoryFromFolder()}>
          <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
          Create new
        </Button>
      </div>
    </div>
  );
};

export default RepositoriesCard;
