import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { normalizeSidebarOptions, type SidebarOptions } from './sidebar-options-model';
import { normalizeSidebarView, type SidebarView } from './sidebar-projection';

const SHELL_KEY = 'sidebar.shell';
const SHELL_QUERY_KEY = ['sidebar', 'shell'] as const;

/**
 * Everything about the sidebar that belongs to the user rather than to the
 * data: which view they are on, which options they chose, what they pinned and
 * in what order, and which rows they left expanded. One key, because they are
 * written together often enough that separate keys would race each other.
 */
export interface SidebarShellState {
  view: SidebarView;
  options: SidebarOptions;
  pinnedIds: string[];
  expandedItemIds: string[];
}

function normalizeShell(stored: unknown): SidebarShellState {
  const raw = (stored ?? {}) as Partial<SidebarShellState>;
  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return {
    view: normalizeSidebarView(raw.view),
    options: normalizeSidebarOptions(raw.options),
    pinnedIds: stringList(raw.pinnedIds),
    expandedItemIds: stringList(raw.expandedItemIds),
  };
}

export function useSidebarViewState() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: SHELL_QUERY_KEY,
    queryFn: async () => normalizeShell(await rpc.viewState.get(SHELL_KEY)),
    staleTime: Infinity,
  });

  const shell = data ?? normalizeShell(null);

  // Optimistic by design: the popover must not wait on a disk write to show
  // the choice the user just made. A failed write throws — the sidebar is
  // then out of step with disk, which is a bug worth seeing, not swallowing.
  const { mutate: persist } = useMutation({
    mutationFn: (next: SidebarShellState) => rpc.viewState.save(SHELL_KEY, next),
    onMutate: (next) => {
      queryClient.setQueryData(SHELL_QUERY_KEY, next);
    },
  });

  const update = useCallback(
    (change: (current: SidebarShellState) => SidebarShellState) => {
      const current = queryClient.getQueryData<SidebarShellState>(SHELL_QUERY_KEY) ?? shell;
      persist(change(current));
    },
    [persist, queryClient, shell]
  );

  const setView = useCallback(
    (view: SidebarView) => update((current) => ({ ...current, view })),
    [update]
  );

  const setOptions = useCallback(
    (options: SidebarOptions) => update((current) => ({ ...current, options })),
    [update]
  );

  const togglePinned = useCallback(
    (workItemId: string) =>
      update((current) => ({
        ...current,
        pinnedIds: current.pinnedIds.includes(workItemId)
          ? current.pinnedIds.filter((id) => id !== workItemId)
          : [...current.pinnedIds, workItemId],
      })),
    [update]
  );

  const reorderPinned = useCallback(
    (pinnedIds: string[]) => update((current) => ({ ...current, pinnedIds })),
    [update]
  );

  const toggleExpanded = useCallback(
    (workItemId: string) =>
      update((current) => ({
        ...current,
        expandedItemIds: current.expandedItemIds.includes(workItemId)
          ? current.expandedItemIds.filter((id) => id !== workItemId)
          : [...current.expandedItemIds, workItemId],
      })),
    [update]
  );

  return {
    view: shell.view,
    options: shell.options,
    pinnedIds: shell.pinnedIds,
    expandedItemIds: shell.expandedItemIds,
    setView,
    setOptions,
    togglePinned,
    reorderPinned,
    toggleExpanded,
  };
}
