import { useCallback, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { notifyReposChanged } from './create-repository';

/**
 * Archiving a repository, shared by the settings card and the sidebar's repo
 * menu so both say the same thing and refresh the same caches.
 *
 * The wording is exported rather than written at each call site: archiving is
 * the one repo action whose consequence is easy to get wrong — it hides the
 * repo from the create-a-work-item pickers and keeps the row, so its work items
 * carry on untouched. That promise has to be identical wherever it is offered.
 */
export const ARCHIVE_REPOSITORY_TITLE =
  'Hide this repository from work item pickers. Its work items keep working.';

export const UNARCHIVE_REPOSITORY_TITLE = 'Show this repository in work item pickers again';

export function useSetRepositoryArchived(): {
  setRepositoryArchived: (repoId: string, archived: boolean) => Promise<void>;
  busyRepoId: string | null;
} {
  const [busyRepoId, setBusyRepoId] = useState<string | null>(null);

  const setRepositoryArchived = useCallback(async (repoId: string, archived: boolean) => {
    setBusyRepoId(repoId);
    try {
      await rpc.repos.setArchived({ id: repoId, archived });
      notifyReposChanged();
    } finally {
      setBusyRepoId(null);
    }
  }, []);

  return { setRepositoryArchived, busyRepoId };
}
