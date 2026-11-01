import { REPOS_QUERY_KEY } from '@renderer/lib/hooks/use-repos';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';

/**
 * Creating a repository where there wasn't one, shared by the settings card and
 * the `newRepository` shortcut so both behave identically from anywhere.
 *
 * Every other add-repo path in the app only *attaches* a folder that is already
 * a git repository; this is the one that makes one.
 */

/** Fired after the repo list changes, for listeners outside the query cache. */
export const REPOS_CHANGED_EVENT = 'chord:repos-changed';

/**
 * The one place a repo-list change is announced: it refreshes the shared
 * `useRepos` cache entries and then fires the DOM event. Both exist because the
 * repo list is read by React through TanStack Query and written by plain
 * functions (this file, the `newRepository` shortcut) that are not in a
 * component and so cannot call the invalidate hook.
 */
export function notifyReposChanged(): void {
  void queryClient.invalidateQueries({ queryKey: REPOS_QUERY_KEY });
  window.dispatchEvent(new CustomEvent(REPOS_CHANGED_EVENT));
}

function aliasFromPath(absolutePath: string): string {
  const segments = absolutePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'repo';
}

export async function createRepositoryFromFolder(): Promise<void> {
  const selected = await rpc.app.openSelectDirectoryDialog({
    title: 'Create repository',
    message: 'Choose an empty folder to turn into a git repository',
  });
  if (!selected) return;

  const result = await rpc.repos.init({ path: selected, alias: aliasFromPath(selected) });
  if (!result.success) {
    toast({ title: result.error.message ?? 'Could not create repository', variant: 'destructive' });
    return;
  }

  notifyReposChanged();
  toast({ title: `Created ${result.data.repo.alias}` });
}

export async function addExistingRepositoryFromFolder(): Promise<void> {
  const selected = await rpc.app.openSelectDirectoryDialog({
    title: 'Add repository',
    message: 'Choose a git repository',
  });
  if (!selected) return;

  const result = await rpc.repos.create({ path: selected, alias: aliasFromPath(selected) });
  if (!result.success) {
    toast({ title: result.error.message ?? 'Could not add repository', variant: 'destructive' });
    return;
  }

  notifyReposChanged();
}
