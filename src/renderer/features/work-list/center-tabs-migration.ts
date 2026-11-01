import { createCenterLayout, type CenterLayoutState } from './center-layout';
import { artifactPathTab, filePathTab, type DocumentTab, type StripTab } from './center-tab';

/**
 * Persisted centre-tab shapes older than the current store version, and the
 * steps that upgrade them (`migrateCenterTabs` in center-tabs-store.ts runs
 * them in order).
 */

/** The document tab kinds before v4 folded files, diffs and artifacts into `path`. */
type LegacyDocumentTab =
  | { kind: 'file'; filePath: string; line?: number; worktreeId?: string; isPreview?: boolean }
  | { kind: 'diff'; filePath: string; worktreeId?: string; isPreview?: boolean }
  | { kind: 'artifact'; artifactId: string; title: string; isPreview?: boolean };

type LegacyTab = LegacyDocumentTab | StripTab;

/** v1 persisted shape, before commit tabs, worktree-aware paths, and stored sessions. */
interface CenterTabsStateV1 {
  tabs?: LegacyTab[];
  active?: LegacyTab;
}

/**
 * v2 persisted shape: one flat strip per work item. `active` is read as a bare
 * kind because a v2 store can hold `{ kind: 'chat' }` — the Room, which no
 * longer exists as a tab.
 */
interface CenterTabsStateV2 {
  tabs?: LegacyTab[];
  active?: LegacyTab | { kind: 'chat' };
  sessionDefaultApplied?: boolean;
}

/** v3 persisted layout node: the split-pane tree, holding legacy tab kinds. */
type LegacyLayoutNode =
  | { kind: 'pane'; id: string; tabs: LegacyTab[]; active: LegacyTab | null }
  | { kind: 'split'; children: [LegacyLayoutNode, LegacyLayoutNode] };

function withPreview<T extends DocumentTab>(tab: T, isPreview: boolean | undefined): T {
  return isPreview === undefined ? tab : { ...tab, isPreview };
}

/** v4: one `path` tab per file or artifact (design 2026-09-26 §3); a diff is a path in `diff` mode. */
function migrateTabToV4(tab: LegacyTab): StripTab {
  switch (tab.kind) {
    case 'file':
      return withPreview(
        filePathTab(tab.filePath, { worktreeId: tab.worktreeId, line: tab.line }),
        tab.isPreview
      );
    case 'diff':
      return withPreview(
        filePathTab(tab.filePath, { worktreeId: tab.worktreeId, mode: 'diff' }),
        tab.isPreview
      );
    case 'artifact':
      return withPreview(artifactPathTab(tab.artifactId, tab.title), tab.isPreview);
    default:
      return tab;
  }
}

function migrateNodeToV4(node: LegacyLayoutNode): CenterLayoutState['root'] {
  if (node.kind === 'pane') {
    return {
      ...node,
      tabs: node.tabs.map(migrateTabToV4),
      active: node.active ? migrateTabToV4(node.active) : null,
    };
  }
  return {
    ...node,
    children: [migrateNodeToV4(node.children[0]), migrateNodeToV4(node.children[1])],
  } as CenterLayoutState['root'];
}

/** v3 → v4 for every work item's layout tree. */
export function migrateLayoutsToV4(
  layouts: Record<string, CenterLayoutState>
): Record<string, CenterLayoutState> {
  return Object.fromEntries(
    Object.entries(layouts).map(([id, layout]) => [
      id,
      { ...layout, root: migrateNodeToV4(layout.root as unknown as LegacyLayoutNode) },
    ])
  );
}

/**
 * v4 → v5: every layout starts with nothing seen, so a teammate view opens its
 * most recently active chat once more, then remembers what it synced.
 */
export function migrateLayoutsToV5(
  layouts: Record<string, CenterLayoutState>
): Record<string, CenterLayoutState> {
  return Object.fromEntries(
    Object.entries(layouts).map(([id, layout]) => [id, { ...layout, seenSessionIds: [] }])
  );
}

/** v1/v2 → v3: each work item's flat strip becomes a one-pane tree (tabs still legacy kinds). */
export function migrateFlatStripsToV3(persisted: unknown): Record<string, CenterLayoutState> {
  const store = persisted as { byWorkItem?: Record<string, CenterTabsStateV1 | CenterTabsStateV2> };
  return Object.fromEntries(
    Object.entries(store.byWorkItem ?? {}).map(([id, state]) => [
      id,
      createCenterLayout({
        // Still legacy kinds here; migrateLayoutsToV4 converts them next.
        tabs: (state.tabs ?? []) as StripTab[],
        // A persisted `{ kind: 'chat' }` active tab is the Room, which no
        // longer exists: the pane opens on nothing and its empty state or
        // the session default takes over.
        active: state.active && state.active.kind !== 'chat' ? (state.active as StripTab) : null,
        sessionDefaultApplied: (state as CenterTabsStateV2).sessionDefaultApplied ?? false,
      }),
    ])
  );
}
