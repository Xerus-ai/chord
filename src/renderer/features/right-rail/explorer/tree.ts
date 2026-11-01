/**
 * The Explorer's tree model: pure, so the panel's only job is to render rows
 * and ask for the directories it does not have yet.
 *
 * Directories load one level at a time. A recursive listing of a real
 * repository is tens of thousands of entries, most of them never looked at,
 * and the one-shot cost lands on the first render of the panel.
 */
export interface ExplorerEntry {
  /** Path relative to the worktree root, as `rpc.fs.listFiles` returns it. */
  path: string;
  type: 'file' | 'dir';
}

export interface ExplorerNode extends ExplorerEntry {
  /** Last path segment — what the row shows. */
  name: string;
  /** 0 for the worktree root's own children. */
  depth: number;
  /** Directories only: whether this node's children are shown. */
  expanded: boolean;
}

/** Directory path (`''` is the root) to that directory's direct children. */
export type DirectoryListings = ReadonlyMap<string, readonly ExplorerEntry[]>;

export function baseName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** Directories first, then case-insensitive name — the order every file tree uses. */
export function compareEntries(a: ExplorerEntry, b: ExplorerEntry): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return baseName(a.path).localeCompare(baseName(b.path), undefined, { sensitivity: 'base' });
}

/**
 * The visible rows, depth-first: a directory contributes its own row, and its
 * children only while it is expanded AND its listing has arrived. An expanded
 * directory with no listing yet contributes nothing below it — the panel
 * requests that listing and the rows appear when it resolves.
 */
export function flattenTree(
  listings: DirectoryListings,
  expanded: ReadonlySet<string>,
  root = ''
): ExplorerNode[] {
  const rows: ExplorerNode[] = [];

  const walk = (dirPath: string, depth: number) => {
    const children = listings.get(dirPath);
    if (!children) return;
    for (const entry of [...children].sort(compareEntries)) {
      const isExpanded = entry.type === 'dir' && expanded.has(entry.path);
      rows.push({ ...entry, name: baseName(entry.path), depth, expanded: isExpanded });
      if (isExpanded) walk(entry.path, depth + 1);
    }
  };

  walk(root, 0);
  return rows;
}

/** Directories that are expanded but whose children have not been listed yet. */
export function pendingDirectories(
  listings: DirectoryListings,
  expanded: ReadonlySet<string>
): string[] {
  return [...expanded].filter((path) => !listings.has(path));
}

/**
 * Toggling a directory. Collapsing drops the descendants' expanded state too,
 * so reopening a folder shows it closed rather than restoring a tree the user
 * stopped looking at three navigations ago.
 */
export function toggleDirectory(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded);
  if (!next.delete(path)) {
    next.add(path);
    return next;
  }
  for (const candidate of expanded) {
    if (candidate.startsWith(`${path}/`)) next.delete(candidate);
  }
  return next;
}

/**
 * The Names search: a flat, ranked filter over known paths. A match on the
 * file name outranks a match anywhere else in the path, so typing "index"
 * surfaces `index.ts` above `src/index-utils/helper.ts`.
 */
export function filterByName(paths: readonly string[], query: string, limit = 100): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const nameMatches: string[] = [];
  const pathMatches: string[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (baseName(lower).includes(needle)) nameMatches.push(path);
    else if (lower.includes(needle)) pathMatches.push(path);
  }
  return [...nameMatches, ...pathMatches].slice(0, limit);
}
