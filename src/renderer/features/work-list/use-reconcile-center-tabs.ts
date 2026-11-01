import { useLayoutEffect, useMemo, useRef } from 'react';
import { log } from '@renderer/utils/logger';
import type { DocumentTab, StripTab } from './center-tab';
import type { PathTabArtifact } from './center-tabs-model';
import type { CenterTabsController } from './center-tabs-store';

/**
 * Keeps persisted tabs honest against what actually exists.
 *
 * The first time each source loads, tabs restored from a previous run whose
 * target is gone are dropped (and logged) — before paint, so they never flash
 * as deleted. After that, an artifact deleted while its tab is open is NOT
 * silently removed: the returned set marks it so the tab strikes through, and
 * the user closes it.
 *
 * `liveSessionIds` is different: sessions end at runtime, not just between
 * restarts, so it reconciles on every change, not only the first load.
 *
 * `liveWorktreeIds` too: a file, diff or commit tab bound to a worktree closes
 * once that worktree is archived or deleted. The first list drops tabs for any
 * worktree not in it; later lists only drop worktrees that left the previous
 * one, so a tab opened for a worktree newer than the cached list survives.
 * (Per-worktree file membership isn't checked: `listRepoFiles` only reads the
 * primary checkout.)
 */
export function useReconcileCenterTabs(
  controller: CenterTabsController,
  sources: {
    /** Null while the list is loading or refetching — never judged against stale data. */
    artifactIds: ReadonlySet<string> | null;
    /**
     * The owner's artifacts with their repo paths: artifact and file tabs for
     * the same path become one tab (`normalizePathTabs`) whenever it changes.
     */
    pathArtifacts?: readonly PathTabArtifact[] | null;
    /** The primary worktree's id: a path tab naming it is the primary-worktree tab. */
    primaryWorktreeId?: string;
    /** Repo file membership; file tabs outside it are stale. */
    repoFiles?: ReadonlySet<string> | null;
    /** Live agent/terminal session ids for this work item. Null while loading — skipped. */
    liveSessionIds?: ReadonlySet<string> | null;
    /** Unarchived worktree ids for this work item. Null while loading — skipped. */
    liveWorktreeIds?: ReadonlySet<string> | null;
    /** Tabs to mark missing artifacts in: every pane's, where the centre is split. */
    openTabs?: readonly StripTab[];
  }
): ReadonlySet<string> {
  const {
    artifactIds,
    pathArtifacts,
    primaryWorktreeId,
    repoFiles,
    liveSessionIds,
    liveWorktreeIds,
    openTabs,
  } = sources;
  const { prune, reconcileSessions, normalizePaths } = controller;
  const tabs = openTabs ?? controller.tabs;
  const artifactsReconciled = useRef(false);
  const filesReconciled = useRef(false);
  const previousWorktreeIds = useRef<ReadonlySet<string> | null>(null);

  useLayoutEffect(() => {
    if (artifactsReconciled.current || artifactIds === null) return;
    artifactsReconciled.current = true;
    prune((tab) => {
      // A path tab with a file outlives its artifact: normalization makes it the file.
      const stale =
        tab.kind === 'path' &&
        tab.artifactId !== undefined &&
        tab.filePath === undefined &&
        !artifactIds.has(tab.artifactId);
      if (stale) log.info('[center-tabs] dropped restored tab for a missing artifact', { tab });
      return stale;
    });
  }, [artifactIds, prune]);

  useLayoutEffect(() => {
    if (pathArtifacts) normalizePaths(pathArtifacts, primaryWorktreeId);
  }, [pathArtifacts, primaryWorktreeId, normalizePaths]);

  useLayoutEffect(() => {
    if (filesReconciled.current || !repoFiles) return;
    filesReconciled.current = true;
    prune((tab) => {
      // `repoFiles` lists the primary checkout; another worktree's files aren't judged by it.
      const stale =
        tab.kind === 'path' &&
        tab.filePath !== undefined &&
        tab.artifactId === undefined &&
        !tab.worktreeId &&
        !repoFiles.has(tab.filePath);
      if (stale) log.info('[center-tabs] dropped restored tab for a missing file', { tab });
      return stale;
    });
  }, [repoFiles, prune]);

  useLayoutEffect(() => {
    if (!liveWorktreeIds) return;
    const previous = previousWorktreeIds.current;
    previousWorktreeIds.current = liveWorktreeIds;
    prune((tab) => {
      const stale = isTabOnRemovedWorktree(tab, liveWorktreeIds, previous);
      if (stale) log.info('[center-tabs] dropped tab for a removed worktree', { tab });
      return stale;
    });
  }, [liveWorktreeIds, prune]);

  useLayoutEffect(() => {
    if (!liveSessionIds) return;
    reconcileSessions(liveSessionIds);
  }, [liveSessionIds, reconcileSessions]);

  return useMemo(() => {
    if (artifactIds === null) return EMPTY;
    const missing = tabs.flatMap((tab) =>
      tab.kind === 'path' && tab.artifactId !== undefined && !artifactIds.has(tab.artifactId)
        ? [tab.artifactId]
        : []
    );
    return missing.length > 0 ? new Set(missing) : EMPTY;
  }, [tabs, artifactIds]);
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Whether a document tab is bound to a worktree that is gone: absent from
 * `live`, and — once a previous list exists — present in that one.
 */
export function isTabOnRemovedWorktree(
  tab: DocumentTab,
  live: ReadonlySet<string>,
  previous: ReadonlySet<string> | null
): boolean {
  const worktreeId = tab.worktreeId;
  if (worktreeId === undefined || live.has(worktreeId)) return false;
  return previous === null || previous.has(worktreeId);
}
