import type { GitObjectRef } from '@shared/git';

export type TabViewSnapshot = {
  tabOrder: string[];
  activeTabId: string | undefined;
};

export type EditorViewSnapshot = {
  tabs: Array<{ tabId: string; path: string; isPreview: boolean }>;
  activeTabId: string | null;
  expandedPaths: string[];
};

export type DiffViewSnapshot = {
  diffStyle: 'unified' | 'split';
  viewMode: 'file';
  activeFile?: ActiveFile;
  commitAction: 'commit' | 'commit-push' | null;
  prTab?: 'files' | 'commits' | 'checks';
};

export interface ActiveFile {
  path: string;
  /** Storage layer: how content is fetched.
   *  'disk' = working-tree read (disk://)
   *  'git'  = git-object read (git://) */
  type: 'disk' | 'git';
  /** Semantic context: which diff panel/group this file belongs to.
   *  Determines which side is original/modified and which events make it stale.
   *  'disk'   = working tree vs HEAD
   *  'staged' = index vs HEAD
   *  'git'    = arbitrary ref-to-ref comparison
   *  'pr'     = PR diff (originalRef is remote-tracking base) */
  group: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  /** PR head SHA for the modified side of a 'pr' group diff.
   *  When absent the diff stack falls back to HEAD_REF. */
  modifiedRef?: GitObjectRef;
  /** Set only when group === 'pr'. Identifies the PR for store lookups. */
  prNumber?: number;
}

export type TaskViewSnapshot = {
  view: string | null;
  rightPanelView: string | null;
  focusedRegion: 'main' | 'right';
  conversations?: TabViewSnapshot;
  terminals?: TabViewSnapshot;
  editor?: EditorViewSnapshot;
  diffView?: DiffViewSnapshot;
};

export type ProjectViewSnapshot = {
  activeView: string;
  taskViewTab: 'active' | 'archived';
};

export type NavigationSnapshot = {
  currentViewId: string;
  viewParams: Record<string, unknown>;
};

export type SidebarTaskSortBy = 'created-at' | 'updated-at';

/** Persisted sidebar UI state; fields may be absent in older DB blobs. */
export type SidebarSnapshot = {
  expandedProjectIds?: string[];
  projectOrder?: string[];
  taskOrderByProject?: Record<string, string[]>;
  taskSortBy?: SidebarTaskSortBy;
};

/**
 * Key `'sidebar.lastViewedAt'`: the epoch-second moment the user last opened
 * each work item, keyed by work item id. Written by the sidebar when a row
 * is opened (T3.3, not yet implemented). Read by
 * `main/core/work-items/sidebar-worktree-summaries.ts` to derive
 * `hasUnreadFinishedTurn` — a work item with no entry here has never been
 * viewed, so any finished turn counts as unread.
 */
export type SidebarLastViewedAtSnapshot = Record<string, number>;
