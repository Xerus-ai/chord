import { createContext, useContext } from 'react';

/**
 * Repo file paths of the work item currently on screen, provided by the
 * work-item surface so deep consumers (markdown inline code) can resolve
 * file references without prop drilling. Null outside a work item — file
 * linkification simply stays off there.
 */
export const RepoFilesContext = createContext<ReadonlySet<string> | null>(null);

export function useRepoFilesContext(): ReadonlySet<string> | null {
  return useContext(RepoFilesContext);
}
