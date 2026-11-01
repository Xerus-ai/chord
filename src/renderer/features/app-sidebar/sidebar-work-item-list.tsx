import { useState } from 'react';
import type { SidebarSummary } from '@shared/sidebar-summaries';
import { ArtifactSubrows } from './artifact-subrows';
import { DiscoveredWorktreeRows } from './discovered-worktree-rows';
import type { RepoGroupActions } from './repo-group-menu';
import { resolveRepoIdentity, type RepoIdentityLookup } from './repo-identity-lookup';
import { RowContextMenu, type RowContextMenuActions } from './row-context-menu';
import { RowHoverCard } from './row-hover-card';
import { isCardExpandable } from './row-presentation';
import type { SidebarOptions } from './sidebar-options-model';
import type { SidebarGroup, SidebarItem, SidebarView } from './sidebar-projection';
import { GroupHeader } from './sidebar-section';
import { SoloRepoLine } from './solo-repo-line';
import type { DiscoveredWorktreesProps } from './use-discovered-worktrees';
import type { LaneActions } from './use-lane-actions';
import { WorkItemCardChildren } from './work-item-card-children';
import { WorkItemRow } from './work-item-row';
import { WorkItemSubrows } from './work-item-subrows';

/** Lane rows' actions (`use-lane-actions.ts`) ride along with the row menu's. */
export interface SidebarRowActions extends RowContextMenuActions, LaneActions {
  onToggleExpanded: (workItemId: string) => void;
  onFocusSession: (workItemId: string, sessionId: string) => void;
  /** A child row of an item reached only through artifacts shared alone. */
  onOpenArtifact: (workItemId: string, artifactId: string) => void;
}

interface ListProps {
  items: readonly SidebarItem[];
  options: SidebarOptions;
  view: SidebarView;
  activeWorkItemId: string | null;
  expandedItemIds: readonly string[];
  pinnedIds: readonly string[];
  summaryMap: Map<string, SidebarSummary>;
  /** 1-based Mod+N position per work item id, for the first nine rows only. */
  jumpIndexById: ReadonlyMap<string, number>;
  /** Local repo rows by id — the source of every repo tile's icon, and of
   *  whether a group is a local repo at all. */
  repoIdentities: RepoIdentityLookup;
  actions: SidebarRowActions;
  /** Needs You rows trade the diff stat for their reason. */
  showNeedsYouReason?: boolean;
  indented?: boolean;
}

/**
 * A run of work item rows with everything attached to them: the hover card,
 * the row menu, and the expanded worktree/session subtree. Kept apart from
 * `AppSidebar` so the shell only wires data, and every section renders rows
 * through exactly one component.
 */
export function SidebarWorkItemList({
  items,
  options,
  view,
  activeWorkItemId,
  expandedItemIds,
  pinnedIds,
  summaryMap,
  jumpIndexById,
  repoIdentities,
  actions,
  showNeedsYouReason = false,
  indented = false,
}: ListProps) {
  return (
    <>
      {items.map((item) => {
        const summary = summaryMap.get(item.id);
        const isActive = item.id === activeWorkItemId;
        const isExpanded = expandedItemIds.includes(item.id);
        // Nothing to expand into unless there is a second worktree, a live
        // session or an archived lane — a chevron that opens one
        // already-visible line is noise.
        // A row standing for artifacts expands into them when there are several.
        const isExpandable = item.sharedArtifacts
          ? item.sharedArtifacts.length > 1
          : isCardExpandable(summary);
        const repoIcon = resolveRepoIdentity(repoIdentities, item.repoId).icon;

        return (
          <div key={item.id}>
            <RowContextMenu item={item} isPinned={pinnedIds.includes(item.id)} actions={actions}>
              <RowHoverCard
                item={item}
                description={summary?.description ?? null}
                repoIcon={repoIcon}
                onOpen={actions.onOpen}
              >
                <WorkItemRow
                  item={item}
                  view={view}
                  repoIcon={repoIcon}
                  isActive={isActive}
                  isExpanded={isExpanded}
                  isExpandable={isExpandable}
                  layout={options.rowLayout}
                  showDiffStat={options.properties.diffStat}
                  showPullRequest={options.properties.pr}
                  showNeedsYouReason={showNeedsYouReason}
                  indented={indented}
                  jumpIndex={jumpIndexById.get(item.id) ?? null}
                  onOpen={actions.onOpen}
                  onToggleExpanded={actions.onToggleExpanded}
                >
                  {/* The active card opens itself; the chevron and
                      `expandedItemIds` keep driving every other row. */}
                  {isActive && isExpandable && summary && (
                    <WorkItemCardChildren
                      workItemId={item.id}
                      worktrees={summary.worktrees}
                      agentSessions={options.agentSessions}
                      showBranch={options.properties.branch}
                      laneHandlers={actions}
                      onFocusSession={(sessionId) => actions.onFocusSession(item.id, sessionId)}
                    />
                  )}
                </WorkItemRow>
              </RowHoverCard>
            </RowContextMenu>

            {isExpanded && item.sharedArtifacts && (
              <ArtifactSubrows
                artifacts={item.sharedArtifacts}
                onOpenArtifact={(artifactId) => actions.onOpenArtifact(item.id, artifactId)}
              />
            )}

            {!isActive && isExpanded && summary && (
              <WorkItemSubrows
                workItemId={item.id}
                worktrees={summary.worktrees}
                agentSessions={options.agentSessions}
                showBranch={options.properties.branch}
                laneHandlers={actions}
                onFocusSession={(sessionId) => actions.onFocusSession(item.id, sessionId)}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function isDoneBand(group: SidebarGroup): boolean {
  return group.kind === 'status' && group.key === 'done';
}

/** One group — a repo or a status band — as a collapsible header plus its rows. */
function GroupBlock({
  group,
  discovered,
  repoActions,
  onDoneOpenChange,
  ...listProps
}: Omit<ListProps, 'items' | 'indented' | 'showNeedsYouReason'> & {
  group: SidebarGroup;
  discovered: DiscoveredWorktreesProps;
  repoActions: RepoGroupActions;
  onDoneOpenChange: (isOpen: boolean) => void;
}) {
  // Finished work is a log, not a queue: the Done band ships closed, and the
  // sidebar above needs to know when it opens to fetch those rows' summaries.
  const [collapsed, setCollapsed] = useState(isDoneBand(group));

  // `+` and `···` both need a local `repos.id`: the create-work-item dialog
  // selects one, and `setIcon`/`setArchived` update one. A group keyed by a
  // teammate's cloud repo name, or by `'no-repo'`, has neither.
  const { icon, isLocal } = resolveRepoIdentity(listProps.repoIdentities, group.key);
  const isLocalRepoGroup = group.kind === 'repo' && isLocal;

  const toggle = () =>
    setCollapsed((prev) => {
      if (isDoneBand(group)) onDoneOpenChange(prev);
      return !prev;
    });

  // An expanded group owns 12px below its last row; its header 8px below itself.
  return (
    <div className={collapsed ? 'mb-0.5' : 'pb-3'}>
      <GroupHeader
        kind={group.kind}
        groupKey={group.key}
        label={group.label}
        tooltip={group.tooltip}
        icon={group.kind === 'repo' ? icon : null}
        currentIcon={icon}
        itemCount={group.items.length}
        isCollapsed={collapsed}
        onToggle={toggle}
        onNewWorkItem={isLocalRepoGroup ? () => repoActions.onNewWorkItem(group.key) : undefined}
        repoActions={isLocalRepoGroup ? repoActions : undefined}
      />
      {isLocalRepoGroup && (
        <SoloRepoLine repoId={group.key} onOpenWorkItem={listProps.actions.onOpen} />
      )}
      {!collapsed && (
        <SidebarWorkItemList
          {...listProps}
          items={group.items}
          // A reason answers "why is this here?", which only the Needs input
          // band asks. Everywhere else the row keeps its diff stat.
          showNeedsYouReason={group.kind === 'status' && group.key === 'needs_input'}
        />
      )}
      {!collapsed && isLocalRepoGroup && (
        <DiscoveredWorktreeRows
          sources={discovered.sourcesByRepo.get(group.key)}
          failure={discovered.failuresByRepo.get(group.key)}
          actions={discovered.actions}
          onArchiveRepo={repoActions.onArchive}
        />
      )}
    </div>
  );
}

export function SidebarGroupList({
  groups,
  discovered,
  repoActions,
  onDoneOpenChange,
  ...listProps
}: Omit<ListProps, 'items' | 'indented' | 'showNeedsYouReason'> & {
  groups: readonly SidebarGroup[];
  discovered: DiscoveredWorktreesProps;
  repoActions: RepoGroupActions;
  onDoneOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <GroupBlock
          key={group.key}
          {...listProps}
          group={group}
          discovered={discovered}
          repoActions={repoActions}
          onDoneOpenChange={onDoneOpenChange}
        />
      ))}
    </>
  );
}
