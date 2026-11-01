import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { filePathTab } from '@renderer/features/work-list/center-tab';
import { openCenterTab, useCenterLayout } from '@renderer/features/work-list/center-tabs-store';
import { describeRpcFailure } from '@renderer/features/work-list/describe-action-failure';
import { useWorkItemViewers } from '@renderer/features/work-list/use-viewing-presence';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { useAgentHandoff } from '../handoff';
import { useRailScope } from '../rail-context';
import { PanelShell, RailEmpty, RailError } from '../rail-primitives';
import { useLiveWorktrees } from '../use-focused-worktree';
import { useWorktreeProject, useWorktreeStatus } from '../use-worktree-git';
import { ExplorerRow, type ExplorerRowActions } from './explorer-row';
import { buildIgnoredMatcher } from './ignored-paths';
import { SearchStrip, type SearchMode } from './search-strip';
import {
  filterByName,
  flattenTree,
  toggleDirectory,
  type DirectoryListings,
  type ExplorerEntry,
  type ExplorerNode,
} from './tree';

const ROOT = '';

/** How many entries a single directory listing may return before it is truncated. */
const MAX_DIRECTORY_ENTRIES = 2000;

/**
 * The focused worktree's file tree, with git decorations and file-level
 * viewing presence.
 *
 * Directories load one level at a time: `useQueries` runs one listing per
 * expanded directory, so expanding a folder costs one call and collapsing it
 * costs nothing. A recursive listing is only taken for Names search, and only
 * while the user is actually typing in it.
 */
export function ExplorerPanel() {
  const scope = useRailScope();
  const { worktreeId, workItemId, layoutKey } = scope;
  const worktrees = useLiveWorktrees(workItemId);
  const worktree = worktrees.find((row) => row.id === worktreeId) ?? null;
  // Path tabs name only non-primary worktrees (center-tab.ts), so a file here
  // and the same file opened as an artifact are one tab.
  const tabWorktreeId = worktree && !worktree.isPrimary ? worktree.id : undefined;

  const projectQuery = useWorktreeProject(worktreeId);
  const projectId = projectQuery.data;
  const enabled = !!projectId && !!worktreeId;

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<SearchMode>('names');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const layout = useCenterLayout(layoutKey);
  const viewers = useWorkItemViewers(workItemId);
  const { status } = useWorktreeStatus(projectId, worktreeId);
  const { handoff } = useAgentHandoff({ workItemId });

  const directories = useMemo(() => [ROOT, ...expanded], [expanded]);

  const listings = useQueries({
    queries: directories.map((dirPath) => ({
      queryKey: ['rail', 'fs', 'list', worktreeId, dirPath],
      queryFn: async () => {
        const result = await rpc.fs.listFiles(projectId as string, worktreeId as string, dirPath, {
          maxEntries: MAX_DIRECTORY_ENTRIES,
        });
        if (!result.success) throw new Error(describeRpcFailure('List files', result.error));
        return result.data.entries.map<ExplorerEntry>((entry) => ({
          path: entry.path,
          type: entry.type,
        }));
      },
      enabled,
      staleTime: 30_000,
    })),
    combine: (results) => {
      const map = new Map<string, readonly ExplorerEntry[]>();
      results.forEach((result, index) => {
        if (result.data) map.set(directories[index], result.data);
      });
      const failed = results.find((result) => result.error instanceof Error);
      return {
        listings: map as DirectoryListings,
        error: failed?.error instanceof Error ? failed.error.message : null,
        loading: results.some((result) => result.isPending),
      };
    },
  });

  // The watcher keeps the open directories fresh; the label scopes this
  // subscription so stopping it never takes down another consumer's watch.
  useEffect(() => {
    if (!enabled) return;
    void rpc.fs.watchSetPaths(
      projectId as string,
      worktreeId as string,
      [...directories],
      'explorer'
    );
    return () => {
      void rpc.fs.watchStop(projectId as string, worktreeId as string, 'explorer');
    };
  }, [enabled, projectId, worktreeId, directories]);

  // A change on disk stales the open listings. Only this worktree's are
  // invalidated: another worktree's watcher firing must not refetch a tree the
  // user is not looking at.
  useEffect(() => {
    if (!worktreeId) return;
    return events.on(fsWatchEventChannel, (event) => {
      if (event.workspaceId !== worktreeId) return;
      void queryClient.invalidateQueries({ queryKey: ['rail', 'fs', 'list', worktreeId] });
    });
  }, [queryClient, worktreeId]);

  const searchingNames = mode === 'names' && query.trim().length > 0;
  const searchingContents = mode === 'contents' && query.trim().length > 1;

  const allPaths = useQuery({
    queryKey: ['rail', 'fs', 'allPaths', worktreeId],
    queryFn: async () => {
      const result = await rpc.fs.listFiles(projectId as string, worktreeId as string, ROOT, {
        recursive: true,
        maxEntries: 20_000,
        timeBudgetMs: 3000,
      });
      if (!result.success) throw new Error(describeRpcFailure('List files', result.error));
      return result.data.entries.filter((e) => e.type === 'file').map((e) => e.path);
    },
    enabled: enabled && searchingNames,
    staleTime: 60_000,
  });

  const contentMatches = useQuery({
    queryKey: ['rail', 'fs', 'search', worktreeId, query],
    queryFn: async () => {
      const result = await rpc.fs.searchFiles(projectId as string, worktreeId as string, query, {
        maxResults: 100,
      });
      if (!result.success) throw new Error(describeRpcFailure('Search files', result.error));
      return result.data.matches;
    },
    enabled: enabled && searchingContents,
    staleTime: 10_000,
  });

  // One read per worktree, not per row: `--directory` collapses a wholly
  // ignored folder to a single prefix, so this is dozens of entries even in a
  // repository with node_modules.
  const ignored = useQuery({
    queryKey: ['rail', 'git', 'ignored', worktreeId],
    queryFn: async () => {
      const result = await rpc.git.listIgnoredPaths(projectId as string, worktreeId as string);
      if (!result.success) throw new Error(describeRpcFailure('List ignored files', result.error));
      return result.data.paths;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  const isIgnored = useMemo(() => buildIgnoredMatcher(ignored.data ?? []), [ignored.data]);

  const gitStatusByPath = useMemo(() => {
    const byPath = new Map<string, string>();
    for (const change of [
      ...(status?.staged ?? []),
      ...(status?.unstaged ?? []),
      ...(status?.untracked ?? []),
      ...(status?.conflicts ?? []),
    ]) {
      byPath.set(change.path, change.status);
    }
    return byPath;
  }, [status]);

  const viewersByFile = useMemo(() => {
    const byFile = new Map<string, typeof viewers>();
    for (const viewer of viewers) {
      const list = byFile.get(viewer.file);
      if (list) list.push(viewer);
      else byFile.set(viewer.file, [viewer]);
    }
    return byFile;
  }, [viewers]);

  const absolutePath = useCallback(
    (path: string) => (worktree ? `${worktree.path}/${path}` : path),
    [worktree]
  );

  const actions = useMemo<ExplorerRowActions>(
    () => ({
      onToggleDirectory: (path) => setExpanded((current) => toggleDirectory(current, path)),
      onPreview: (path) => {
        setSelected(path);
        openCenterTab(layoutKey, filePathTab(path, { worktreeId: tabWorktreeId }), {
          preview: true,
        });
      },
      onPin: (path) => {
        setSelected(path);
        openCenterTab(layoutKey, filePathTab(path, { worktreeId: tabWorktreeId }));
      },
      onOpenToSide: (path) => layout.openToSide(filePathTab(path, { worktreeId: tabWorktreeId })),
      onAddToChat: (path) => {
        void handoff({
          subject: `File: ${path}`,
          detail: `Look at \`${path}\` in ${worktree?.branchName ?? 'this worktree'}.`,
        });
      },
      onCopyPath: (path, relative) => {
        const text = relative ? path : absolutePath(path);
        void rpc.app.clipboardWriteText(text).then((result) => {
          if (result.success) toast({ title: 'Path copied', description: text });
        });
      },
      onReveal: (path) => {
        const parent = absolutePath(path).replace(/\/[^/]*$/, '');
        void rpc.app.openIn({ app: 'finder', path: parent });
      },
    }),
    [layoutKey, tabWorktreeId, layout, handoff, worktree, absolutePath]
  );

  const rows: ExplorerNode[] = useMemo(
    () => flattenTree(listings.listings, expanded),
    [listings.listings, expanded]
  );

  if (projectQuery.error) {
    return (
      <PanelShell title="Files">
        <RailError message={projectQuery.error.message} />
      </PanelShell>
    );
  }
  if (!worktreeId) {
    return (
      <PanelShell title="Files">
        <RailEmpty>No worktree</RailEmpty>
      </PanelShell>
    );
  }

  const renderRow = (node: ExplorerNode) => (
    <ExplorerRow
      key={node.path}
      node={node}
      gitStatus={gitStatusByPath.get(node.path)}
      ignored={isIgnored(node.path)}
      viewers={viewersByFile.get(node.path)}
      selected={selected === node.path}
      actions={actions}
    />
  );

  const searchRows = (paths: string[]) =>
    paths.map((path) => renderRow({ path, type: 'file', name: path, depth: 0, expanded: false }));

  return (
    <PanelShell title="Files">
      <SearchStrip mode={mode} onModeChange={setMode} query={query} onQueryChange={setQuery} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        {listings.error && <RailError message={listings.error} />}
        {allPaths.error instanceof Error && <RailError message={allPaths.error.message} />}
        {contentMatches.error instanceof Error && (
          <RailError message={contentMatches.error.message} />
        )}

        {searchingNames ? (
          (() => {
            const matches = filterByName(allPaths.data ?? [], query);
            return matches.length > 0 ? (
              searchRows(matches)
            ) : (
              <RailEmpty>No matching files</RailEmpty>
            );
          })()
        ) : searchingContents ? (
          (() => {
            const paths = [...new Set((contentMatches.data ?? []).map((match) => match.filePath))];
            return paths.length > 0 ? searchRows(paths) : <RailEmpty>No matches</RailEmpty>;
          })()
        ) : rows.length > 0 ? (
          rows.map(renderRow)
        ) : listings.loading ? (
          <RailEmpty>Loading files</RailEmpty>
        ) : (
          <RailEmpty>Empty worktree</RailEmpty>
        )}
      </div>
    </PanelShell>
  );
}
