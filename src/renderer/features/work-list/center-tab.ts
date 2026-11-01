/**
 * What the centre pane is showing: a session transcript, a path (a file, an
 * artifact, or both), or a commit. There is no pinned chat tab — a chat
 * session IS a session tab, and a pane showing nothing has no active tab.
 */
export type CenterTab = StripTab;

/**
 * A chat-agent or terminal session transcript. Session tabs are stored in the
 * strip alongside documents. Never a preview, and closing one is not this
 * module's job — the caller tells `rpc.agentSessions.markDone` first, then
 * calls `closeTab`.
 */
export type SessionTab = { kind: 'session'; sessionId: string };

/**
 * A teammate's Work item chat: the item's whole conversation while the owner
 * has published no chat (shared-items step 4, decision 5). It holds no
 * session, so it is its own kind rather than a session tab with no id; it is
 * there exactly while no chat is published, and is never closed by hand.
 */
export type ItemChatTab = { kind: 'item-chat' };

export const ITEM_CHAT_TAB: ItemChatTab = { kind: 'item-chat' };

/** How a path tab shows its path (design 2026-09-26 §3); remembered per tab. */
export type PathMode = 'diff' | 'preview' | 'edit';

/**
 * One tab per path (design 2026-09-26 §3): a repo file, an artifact, or a file
 * that is an artifact. Files, Changes, the rail's ARTIFACTS and chat chips all
 * open this one kind, so every entry point focuses the same tab.
 *
 * - `filePath` is relative to the worktree; absent only for an artifact whose
 *   file lives outside the repo (a plan) or that has no file at all.
 * - `worktreeId` undefined means the primary worktree.
 * - `artifactId` is set when the path is an artifact.
 * - `mode` unset means the format's default mode.
 * - `isPreview` is a preview tab: replaced by the next single-click open
 *   until something promotes it.
 */
export type PathTab = {
  kind: 'path';
  title: string;
  filePath?: string;
  worktreeId?: string;
  artifactId?: string;
  mode?: PathMode;
  line?: number;
  isPreview?: boolean;
};

export type CommitTab = { kind: 'commit'; worktreeId: string; sha: string; isPreview?: boolean };

/** Document tabs the strip owns and persists. */
export type DocumentTab = PathTab | CommitTab;

/** Everything the strip stores. Every tab is stored; none is pinned. */
export type StripTab = DocumentTab | SessionTab | ItemChatTab;

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

/** A repo file's tab, titled by its basename. */
export function filePathTab(
  filePath: string,
  options: { worktreeId?: string; line?: number; mode?: PathMode } = {}
): PathTab {
  return {
    kind: 'path',
    filePath,
    title: basename(filePath),
    ...(options.worktreeId !== undefined && { worktreeId: options.worktreeId }),
    ...(options.line !== undefined && { line: options.line }),
    ...(options.mode !== undefined && { mode: options.mode }),
  };
}

/** An artifact's tab, with its repo-relative path when the artifact is a repo file. */
export function artifactPathTab(
  artifactId: string,
  title: string,
  options: { filePath?: string; mode?: PathMode } = {}
): PathTab {
  return {
    kind: 'path',
    artifactId,
    title,
    ...(options.filePath !== undefined && { filePath: options.filePath }),
    ...(options.mode !== undefined && { mode: options.mode }),
  };
}

export function isDocumentTab(tab: CenterTab): tab is DocumentTab {
  return tab.kind === 'path' || tab.kind === 'commit';
}

export function isSessionTab(tab: CenterTab): tab is SessionTab {
  return tab.kind === 'session';
}

/**
 * Whether two path tabs address the same tab: the same path in the same
 * worktree when both have a path, otherwise the same artifact. A bare file and
 * an artifact known only by id are different until `normalizePathTabs` gives
 * the artifact its path. Mode, line and title never distinguish tabs.
 */
function pathTabsEqual(a: PathTab, b: PathTab): boolean {
  if (a.filePath !== undefined && b.filePath !== undefined) {
    return a.filePath === b.filePath && a.worktreeId === b.worktreeId;
  }
  return a.artifactId !== undefined && a.artifactId === b.artifactId;
}

/** Whether two tab requests address the same tab. */
export function centerTabsEqual(a: CenterTab, b: CenterTab): boolean {
  if (a.kind === 'path' && b.kind === 'path') return pathTabsEqual(a, b);
  if (a.kind === 'session' && b.kind === 'session') return a.sessionId === b.sessionId;
  if (a.kind === 'item-chat' && b.kind === 'item-chat') return true;
  if (a.kind === 'commit' && b.kind === 'commit') {
    return a.worktreeId === b.worktreeId && a.sha === b.sha;
  }
  return false;
}

/** Stable identity for React keys and drag reorder; agrees with `centerTabsEqual`. */
export function centerTabKey(tab: CenterTab): string {
  switch (tab.kind) {
    case 'session':
      return `session:${tab.sessionId}`;
    case 'path':
      return tab.filePath !== undefined
        ? `path:${tab.worktreeId ?? ''}:${tab.filePath}`
        : `artifact:${tab.artifactId}`;
    case 'commit':
      return `commit:${tab.worktreeId}:${tab.sha}`;
    case 'item-chat':
      return 'item-chat';
  }
}
