import type { GitChange } from '@shared/git';
import type { SourceControlGroupOrder } from '@shared/git-settings';

/**
 * The Changes tab as a tree, built once and rendered flat.
 *
 * A worktree's changed files are a shape, not a list: 60 paths under
 * `src/renderer/features/...` read as 60 unrelated rows, where four folder
 * rows with their own totals read as the work. Two rules make that shape
 * legible — every folder reports the sum of everything beneath it, and a chain
 * of folders with a single child collapses into one row, so a deeply nested
 * project does not spend six rows saying nothing.
 *
 * Pure, and tested as such: which rows exist and what they total is the part
 * worth arguing about, and it is cheaper to argue about in a test than in a
 * screenshot.
 */
export type ChangesGroup = 'conflicts' | 'staged' | 'unstaged' | 'untracked';

interface RowBase {
  /** Unique across the tree: the same path appears under two groups. */
  id: string;
  depth: number;
  name: string;
  group: ChangesGroup;
  added: number;
  removed: number;
}

export interface GroupRow extends RowBase {
  kind: 'group';
  count: number;
  collapsed: boolean;
}

export interface FolderRow extends RowBase {
  kind: 'folder';
  /** Folder path relative to the worktree root, chain-collapsed. */
  path: string;
  collapsed: boolean;
}

export interface FileRow extends RowBase {
  kind: 'file';
  path: string;
  status: GitChange['status'];
  /** Conflicted files are never discardable: the resolution is the work. */
  canDiscard: boolean;
}

export type ChangesTreeRow = GroupRow | FolderRow | FileRow;

export interface ChangesTreeInput {
  staged: GitChange[];
  unstaged: GitChange[];
  conflicts: GitChange[];
  untracked: GitChange[];
}

const GROUP_LABELS: Record<ChangesGroup, string> = {
  conflicts: 'CONFLICTS',
  staged: 'STAGED',
  unstaged: 'CHANGES',
  untracked: 'UNTRACKED',
};

/**
 * Settings › Git › Source control group order: the chosen group first, the
 * other two in their usual relative order.
 */
const ORDER_BY_SETTING: Record<SourceControlGroupOrder, readonly ChangesGroup[]> = {
  changes: ['unstaged', 'staged', 'untracked'],
  staged: ['staged', 'unstaged', 'untracked'],
  untracked: ['untracked', 'unstaged', 'staged'],
};

/**
 * The groups top to bottom. Conflicts are pinned first whatever the setting:
 * they are the only state that blocks every other action, so burying them
 * under other groups hides the reason the band's button says what it says.
 */
export function resolveChangesGroupOrder(order: SourceControlGroupOrder): ChangesGroup[] {
  return ['conflicts', ...ORDER_BY_SETTING[order]];
}

interface Node {
  name: string;
  children: Map<string, Node>;
  file: GitChange | null;
  added: number;
  removed: number;
}

function emptyNode(name: string): Node {
  return { name, children: new Map(), file: null, added: 0, removed: 0 };
}

/** Builds the folder/file tree for one group and sums totals on the way up. */
function treeFor(changes: GitChange[]): Node {
  const root = emptyNode('');
  for (const change of changes) {
    const segments = change.path.split('/').filter(Boolean);
    let node = root;
    node.added += change.additions;
    node.removed += change.deletions;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) {
        child = emptyNode(segment);
        node.children.set(segment, child);
      }
      child.added += change.additions;
      child.removed += change.deletions;
      node = child;
    }
    node.file = change;
  }
  return root;
}

/** Directories first, then case-insensitive name — the order every file tree uses. */
function sortChildren(node: Node): Node[] {
  return [...node.children.values()].sort((a, b) => {
    const aDir = a.file === null;
    const bDir = b.file === null;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/**
 * Walks a folder down through every single-child folder, returning the node to
 * render and the joined name. `src` → `renderer` → `features` is one row
 * reading `src/renderer/features`; the moment a folder has two children, or a
 * file of its own, the chain ends.
 */
function collapseChain(node: Node, path: string): { node: Node; name: string; path: string } {
  let current = node;
  let name = node.name;
  let fullPath = path;
  while (current.children.size === 1) {
    const [only] = current.children.values();
    if (!only || only.file !== null) break;
    name = `${name}/${only.name}`;
    fullPath = `${fullPath}/${only.name}`;
    current = only;
  }
  return { node: current, name, path: fullPath };
}

/**
 * The visible rows, in render order.
 *
 * `collapsed` holds the ids of folders and groups the user has closed —
 * `"<group>:<path>"` for a folder, `"<group>"` for a group — so a folder
 * closed in Staged stays open in Changes, which is where the same path means
 * a different thing.
 */
export function buildChangesTree(
  input: ChangesTreeInput,
  collapsed: ReadonlySet<string>,
  order: SourceControlGroupOrder
): ChangesTreeRow[] {
  const rows: ChangesTreeRow[] = [];

  for (const group of resolveChangesGroupOrder(order)) {
    const label = GROUP_LABELS[group];
    const changes = input[group];
    if (changes.length === 0) continue;

    const root = treeFor(changes);
    const groupCollapsed = collapsed.has(group);
    rows.push({
      kind: 'group',
      id: group,
      depth: 0,
      name: label,
      group,
      count: changes.length,
      collapsed: groupCollapsed,
      added: root.added,
      removed: root.removed,
    });
    if (groupCollapsed) continue;

    const walk = (node: Node, parentPath: string, depth: number) => {
      for (const child of sortChildren(node)) {
        const childPath = parentPath ? `${parentPath}/${child.name}` : child.name;

        if (child.file) {
          rows.push({
            kind: 'file',
            id: `${group}:${childPath}`,
            depth,
            name: child.name,
            path: child.file.path,
            group,
            status: child.file.status,
            canDiscard: child.file.status !== 'conflicted',
            added: child.added,
            removed: child.removed,
          });
          continue;
        }

        const chain = collapseChain(child, childPath);
        const id = `${group}:${chain.path}`;
        const isCollapsed = collapsed.has(id);
        rows.push({
          kind: 'folder',
          id,
          depth,
          name: chain.name,
          path: chain.path,
          group,
          collapsed: isCollapsed,
          added: chain.node.added,
          removed: chain.node.removed,
        });
        if (!isCollapsed) walk(chain.node, chain.path, depth + 1);
      }
    };

    walk(root, '', 1);
  }

  return rows;
}
