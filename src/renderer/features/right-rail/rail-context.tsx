import { createContext, useContext } from 'react';

/**
 * What every rail panel needs to address the thing it is showing.
 *
 * Panels read this rather than taking props so they can stay mounted while the
 * focus moves: a panel keyed by worktree id would unmount and remount on every
 * tab switch, and each remount refires its queries, which on Windows is an IPC
 * storm. The rule is selectors, never keys.
 *
 * `worktreeId` is the `workspaceId` half of the `(projectId, workspaceId)`
 * pair `rpc.git.*` and `rpc.fs.*` take; the other half comes from
 * `useWorktreeProject`. It is null only while the worktree list is loading, or
 * for a teammate, who has no checkout at all.
 */
export interface RailScope {
  workItemId: string;
  /** Centre-layout key for `openCenterTab` — the participant view has its own. */
  layoutKey: string;
  worktreeId: string | null;
}

const RailScopeContext = createContext<RailScope | null>(null);

export const RailScopeProvider = RailScopeContext.Provider;

export function useRailScope(): RailScope {
  const scope = useContext(RailScopeContext);
  if (!scope) throw new Error('useRailScope must be rendered inside RailScopeProvider');
  return scope;
}

/**
 * The scope with a resolved worktree, for panels that cannot render anything
 * meaningful without one. Returns null while the worktree list is loading so
 * the caller shows its own empty state instead of calling an RPC with a
 * placeholder id.
 */
export function useResolvedRailScope(): (RailScope & { worktreeId: string }) | null {
  const scope = useRailScope();
  if (!scope.worktreeId) return null;
  return scope as RailScope & { worktreeId: string };
}
