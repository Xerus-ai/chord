import {
  centerTabKey,
  centerTabsEqual,
  filePathTab,
  isDocumentTab,
  type CenterTab,
  type DocumentTab,
  type PathTab,
  type StripTab,
} from './center-tab';

/**
 * One work item's centre tabs. `tabs` are everything the strip stores — files,
 * diffs, artifacts, commits, and session transcripts — and `active` is
 * whichever one is showing, or null when the pane has nothing to show and
 * renders its empty state. `sessionDefaultApplied` guards the single-session
 * auto-open (see `defaultActiveForSessions`) so it never fires twice and never
 * overrides a user who closed what it opened.
 */
export interface CenterTabsState {
  tabs: StripTab[];
  active: StripTab | null;
  sessionDefaultApplied: boolean;
}

export const EMPTY_CENTER_TABS: CenterTabsState = {
  tabs: [],
  active: null,
  sessionDefaultApplied: false,
};

/** Marks the state as having seen an explicit user navigation. */
function touched(state: CenterTabsState): CenterTabsState {
  return state.sessionDefaultApplied ? state : { ...state, sessionDefaultApplied: true };
}

export function openTab(
  state: CenterTabsState,
  tab: CenterTab,
  { preview }: { preview: boolean }
): CenterTabsState {
  // A session or the Work item chat: never a preview, one per strip.
  if (!isDocumentTab(tab)) {
    const existing = state.tabs.find((t) => centerTabsEqual(t, tab));
    if (existing) return touched({ ...state, active: existing });
    return touched({ ...state, tabs: [...state.tabs, tab], active: tab });
  }

  const existingIndex = state.tabs.findIndex((t) => centerTabsEqual(t, tab));
  if (existingIndex >= 0) {
    // A preview request never demotes a permanent tab; a permanent one promotes.
    const existing = state.tabs[existingIndex] as DocumentTab;
    const next = {
      ...mergeTabRequest(existing, tab),
      isPreview: preview ? (existing.isPreview ?? false) : false,
    };
    return touched({ ...state, tabs: replaceAt(state.tabs, existingIndex, next), active: next });
  }

  if (preview) {
    const next = { ...tab, isPreview: true };
    const previewIndex = state.tabs.findIndex((t) => isDocumentTab(t) && t.isPreview);
    const tabs =
      previewIndex >= 0 ? replaceAt(state.tabs, previewIndex, next) : [...state.tabs, next];
    return touched({ ...state, tabs, active: next });
  }

  const next = { ...tab, isPreview: false };
  return touched({ ...state, tabs: [...state.tabs, next], active: next });
}

export function promoteTab(state: CenterTabsState, tab: DocumentTab): CenterTabsState {
  const index = state.tabs.findIndex((t) => centerTabsEqual(t, tab));
  if (index < 0) return state;
  const existing = state.tabs[index];
  if (!isDocumentTab(existing) || !existing.isPreview) return state;
  const promoted = { ...existing, isPreview: false };
  const active = state.active && centerTabsEqual(state.active, promoted) ? promoted : state.active;
  return { ...state, tabs: replaceAt(state.tabs, index, promoted), active };
}

export function activateTab(state: CenterTabsState, tab: CenterTab): CenterTabsState {
  const existing = state.tabs.find((t) => centerTabsEqual(t, tab));
  return existing ? touched({ ...state, active: existing }) : state;
}

/**
 * Removes one tab. For a session tab this only drops it from strip state —
 * the caller ends the underlying session (`rpc.agentSessions.markDone`)
 * itself before or after calling this.
 */
export function closeTab(state: CenterTabsState, tab: StripTab): CenterTabsState {
  return removeTabs(state, (t) => centerTabsEqual(t, tab));
}

/**
 * Bulk close operations only ever touch document tabs (files, diffs,
 * artifacts, commits). Session tabs are left alone — closing a session is a
 * lifecycle action (`rpc.agentSessions.markDone`), not a strip operation, so
 * "Close All" etc. must not silently end someone's terminal or chat session.
 */
export function closeOtherTabs(state: CenterTabsState, tab: DocumentTab): CenterTabsState {
  const kept = state.tabs.find((t) => centerTabsEqual(t, tab));
  if (!kept) return state;
  const tabs = state.tabs.filter((t) => !isDocumentTab(t) || centerTabsEqual(t, tab));
  if (tabs.length === state.tabs.length) return { ...state, active: kept };
  return { ...state, tabs, active: kept };
}

export function closeTabsToRight(state: CenterTabsState, tab: DocumentTab): CenterTabsState {
  const index = state.tabs.findIndex((t) => centerTabsEqual(t, tab));
  if (index < 0) return state;
  return removeTabs(state, (t, i) => i > index && isDocumentTab(t), state.tabs[index]);
}

export function closeTabsToLeft(state: CenterTabsState, tab: DocumentTab): CenterTabsState {
  const index = state.tabs.findIndex((t) => centerTabsEqual(t, tab));
  if (index < 0) return state;
  return removeTabs(state, (t, i) => i < index && isDocumentTab(t), state.tabs[index]);
}

export function closeAllTabs(state: CenterTabsState): CenterTabsState {
  return removeTabs(state, (t) => isDocumentTab(t));
}

/** Drops document tabs whose target no longer exists (restore after restart). */
export function pruneTabs(
  state: CenterTabsState,
  isStale: (tab: DocumentTab) => boolean
): CenterTabsState {
  return removeTabs(state, (t) => isDocumentTab(t) && isStale(t));
}

/**
 * Drops session tabs whose id isn't live anymore — the process that owned
 * them ended (restart, or the session itself ended at runtime). Unlike
 * `pruneTabs` this is meant to be called continuously, not just once on load,
 * since sessions can end at any time.
 */
export function reconcileSessions(
  state: CenterTabsState,
  liveSessionIds: ReadonlySet<string>
): CenterTabsState {
  return removeTabs(state, (t) => t.kind === 'session' && !liveSessionIds.has(t.sessionId));
}

/**
 * Single-session convenience default: if this work item has exactly one live
 * chat agent session and nobody has navigated yet (nothing active, no stored
 * tabs), open that session and focus it. Idempotent — guarded by
 * `sessionDefaultApplied` so it fires once per item and never re-opens what a
 * user closed on purpose.
 */
export function defaultActiveForSessions(
  state: CenterTabsState,
  chatSessionIds: readonly string[]
): CenterTabsState {
  if (state.sessionDefaultApplied) return state;
  if (state.active !== null || state.tabs.length > 0) return state;
  if (chatSessionIds.length !== 1) return state;
  const tab: StripTab = { kind: 'session', sessionId: chatSessionIds[0] };
  return { tabs: [tab], active: tab, sessionDefaultApplied: true };
}

/**
 * Appends a tab for every live session the strip does not show yet, without
 * moving focus. A session tab is how a session is reached (closing one ends
 * the session), so a live session must never be tab-less — e.g. one started
 * from the sidebar or restored from a pre-Phase-1 store.
 */
export function ensureSessionTabs(
  state: CenterTabsState,
  liveSessionIds: readonly string[]
): CenterTabsState {
  const open = new Set(state.tabs.flatMap((t) => (t.kind === 'session' ? [t.sessionId] : [])));
  const missing = liveSessionIds.filter((id) => !open.has(id));
  if (missing.length === 0) return state;
  const added: StripTab[] = missing.map((sessionId) => ({ kind: 'session', sessionId }));
  return { ...state, tabs: [...state.tabs, ...added] };
}

export interface SessionTabSource {
  id: string;
  kind: string;
  status: string;
}

/** Pure reorder for drag-and-drop across the stored tab list. */
export function moveTab(state: CenterTabsState, from: string, toIndex: number): CenterTabsState {
  const fromIndex = state.tabs.findIndex((t) => centerTabKey(t) === from);
  if (fromIndex < 0) return state;
  const clamped = Math.max(0, Math.min(toIndex, state.tabs.length - 1));
  if (clamped === fromIndex) return state;
  const tabs = state.tabs.slice();
  const [moved] = tabs.splice(fromIndex, 1);
  tabs.splice(clamped, 0, moved);
  return { ...state, tabs };
}

/**
 * Removes matching tabs. If the active tab goes, focus moves to `focusTarget`
 * when given, otherwise to the nearest surviving tab on its left, otherwise the
 * first surviving tab. Only an emptied strip leaves nothing active, which is
 * what makes a pane show its empty state.
 */
function removeTabs(
  state: CenterTabsState,
  shouldRemove: (tab: StripTab, index: number) => boolean,
  focusTarget?: StripTab
): CenterTabsState {
  const tabs = state.tabs.filter((t, i) => !shouldRemove(t, i));
  if (tabs.length === state.tabs.length) return state;

  const activeIndex = state.active
    ? state.tabs.findIndex((t) => centerTabsEqual(t, state.active as StripTab))
    : -1;
  const activeSurvives = activeIndex < 0 || !shouldRemove(state.tabs[activeIndex], activeIndex);
  if (activeSurvives) return { ...state, tabs };
  if (focusTarget) return { ...state, tabs, active: focusTarget };

  for (let i = activeIndex - 1; i >= 0; i--) {
    if (!shouldRemove(state.tabs[i], i)) return { ...state, tabs, active: state.tabs[i] };
  }
  // Nothing survives to the left — closing the first tab moves focus to what
  // is now the first tab, rather than emptying a pane that still has tabs.
  return { ...state, tabs, active: tabs[0] ?? null };
}

/**
 * A request for a tab that is already open updates it rather than replacing
 * it: fields the request names win (a mode, a line to reveal), fields it
 * leaves out stay (a path, a mode). An artifact tab keeps its artifact's name
 * when the same path is opened as a file.
 */
function mergeTabRequest(existing: DocumentTab, request: DocumentTab): DocumentTab {
  if (existing.kind !== 'path' || request.kind !== 'path') return request;
  const named = Object.fromEntries(
    Object.entries(request).filter(([, value]) => value !== undefined)
  ) as PathTab;
  const keepTitle = existing.artifactId !== undefined && request.artifactId === undefined;
  return { ...existing, ...named, ...(keepTitle && { title: existing.title }) };
}

/** An artifact as `normalizePathTabs` needs it: its repo-relative path, if it is a repo file. */
export interface PathTabArtifact {
  id: string;
  name: string;
  repoRelativePath: string | null;
}

function normalizePathTab(
  original: PathTab,
  byId: ReadonlyMap<string, PathTabArtifact>,
  byPath: ReadonlyMap<string, PathTabArtifact>,
  primaryWorktreeId: string | undefined
): PathTab {
  // Undefined is the primary worktree; a tab that names it by id is the same tab.
  let tab = original;
  if (primaryWorktreeId !== undefined && tab.worktreeId === primaryWorktreeId) {
    tab = { ...tab };
    delete tab.worktreeId;
  }
  if (tab.artifactId !== undefined) {
    const artifact = byId.get(tab.artifactId);
    if (!artifact) {
      // The artifact is gone but its file is not: the tab stays, as the file.
      if (tab.filePath === undefined) return tab;
      const file: PathTab = { ...tab, title: filePathTab(tab.filePath).title };
      delete file.artifactId;
      return file;
    }
    if (tab.filePath === undefined && artifact.repoRelativePath !== null) {
      return { ...tab, filePath: artifact.repoRelativePath };
    }
    return tab;
  }
  // Artifacts live in the primary checkout; another worktree's copy is a plain file.
  if (tab.filePath === undefined || tab.worktreeId !== undefined) return tab;
  const artifact = byPath.get(tab.filePath);
  return artifact ? { ...tab, artifactId: artifact.id, title: artifact.name } : tab;
}

/**
 * Joins the two ways to reach an artifact: a tab opened by id (ARTIFACTS, a
 * chat chip) gets its repo path, a primary-worktree file tab learns it is an
 * artifact, and tabs that turn out to be one merge into the first. A tab whose
 * artifact was deleted keeps showing its file. Same state back when nothing
 * changes.
 */
export function normalizePathTabs(
  state: CenterTabsState,
  artifacts: readonly PathTabArtifact[],
  primaryWorktreeId?: string
): CenterTabsState {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const byPath = new Map(
    artifacts.flatMap((a) =>
      a.repoRelativePath === null ? [] : [[a.repoRelativePath, a] as const]
    )
  );
  let changed = false;
  const normalized = state.tabs.map((tab) => {
    if (tab.kind !== 'path') return tab;
    const next = normalizePathTab(tab, byId, byPath, primaryWorktreeId);
    if (next !== tab) changed = true;
    return next;
  });

  // Each normalized tab's survivor: itself, or an earlier tab it now equals.
  const survivorOf = normalized.map((tab, i) =>
    normalized.findIndex((t, j) => j <= i && centerTabsEqual(t, tab))
  );
  const tabs = normalized.filter((_, i) => survivorOf[i] === i);
  if (!changed && tabs.length === normalized.length) return state;

  const activeIndex = state.active
    ? state.tabs.findIndex((t) => centerTabsEqual(t, state.active as StripTab))
    : -1;
  const active = activeIndex < 0 ? state.active : normalized[survivorOf[activeIndex]];
  return { ...state, tabs, active };
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  const copy = list.slice();
  copy[index] = value;
  return copy;
}
