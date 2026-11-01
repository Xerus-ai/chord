import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { useEffect, useMemo } from 'react';
import { RailPanels, WorkItemRail } from '@renderer/features/right-rail/rail';
import type { RailScope } from '@renderer/features/right-rail/rail-context';
import { ScopedWorkItemPanel } from '@renderer/features/right-rail/work-item/scoped-panel';
import { artifactPathTab } from '@renderer/features/work-list/center-tab';
import {
  openCenterTab,
  selectOpenCenterTabs,
  useCenterTabsStore,
} from '@renderer/features/work-list/center-tabs-store';
import { CloudPathTabBody } from '@renderer/features/work-list/cloud-path-tab-body';
import {
  offersDocumentTo,
  participantLayoutKey,
  type PaneHost,
} from '@renderer/features/work-list/pane-host';
import type { SessionTabModel } from '@renderer/features/work-list/session-tab-model';
import { resolveWorkItemCapabilities } from '@renderer/features/work-list/work-item-access';
import { WorkItemHeader } from '@renderer/features/work-list/work-item-header';
import { headerModel } from '@renderer/features/work-list/work-item-header-model';
import type { WorkItemSource } from '@renderer/features/work-list/work-item-source';
import { WorkItemView } from '@renderer/features/work-list/work-item-view';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { scopedViewArtifactIds } from './scoped-view';

/** An artifacts-only viewer's capabilities: Preview of the shared artifacts, and comments. */
const SCOPED_CAPABILITIES = resolveWorkItemCapabilities({
  viewer: 'member',
  role: 'view',
  scope: 'artifacts',
  approvalPolicy: 'owner',
});

const NO_SESSION_BODIES = {
  byId: new Map<string, SessionTabModel>(),
  render: (): never => {
    throw new Error('An artifacts-only view has no session bodies');
  },
};
const noRoomStatus = () => {};
const passBodies = (bodies: React.ReactNode) => bodies;

/**
 * A work item reached only through artifacts shared alone (step 4, S9;
 * decision 6): the same `WorkItemView`, scoped to those artifacts. Their
 * tabs open in Preview; the rail has only the Work item panel. Nothing here
 * reads a work_item: route or joins the work item's room — the server refuses
 * both — so its live updates come through one `artifact:` room per shared
 * artifact.
 */
export function ScopedWorkItemView({
  item,
  awaitingArtifact,
}: {
  item: ArtifactsOnlyWorkItem;
  /** A link or notification asked for an artifact, which is about to open. */
  awaitingArtifact: boolean;
}) {
  const layoutKey = participantLayoutKey(item.id);
  // Undefined until this layout is first stored: nothing is open yet.
  const openTabs = useCenterTabsStore((store) => selectOpenCenterTabs(store, layoutKey)) ?? [];
  const { acquireArtifactRoom } = useSyncSocketContext();
  const sharedIds = useMemo(() => new Set(scopedViewArtifactIds(item)), [item]);

  useEffect(() => {
    const releases = [...sharedIds].map((id) => acquireArtifactRoom(id, noRoomStatus));
    return () => releases.forEach((release) => release());
  }, [sharedIds, acquireArtifactRoom]);

  // A viewer who arrives with nothing of theirs open, in any pane, sees the
  // first shared artifact, as the artifact link used to show it.
  const opensNothing = !openTabs.some(
    (tab) => tab.kind === 'path' && tab.artifactId !== undefined && sharedIds.has(tab.artifactId)
  );
  useEffect(() => {
    if (!opensNothing || awaitingArtifact) return;
    const [first] = item.shared_artifacts;
    openCenterTab(layoutKey, artifactPathTab(first.id, first.name));
  }, [opensNothing, awaitingArtifact, item.shared_artifacts, layoutKey]);

  const source = useMemo<WorkItemSource>(
    () => ({
      kind: 'scoped',
      item,
      scope: 'artifacts',
      workItemId: item.id,
      layoutKey,
      capabilities: SCOPED_CAPABILITIES,
    }),
    [item, layoutKey]
  );

  const paneHost = useMemo<PaneHost>(
    () => ({
      layoutKey,
      offersDocument: offersDocumentTo(SCOPED_CAPABILITIES, sharedIds),
      sessions: null,
      // Only offered kinds reach here (`selectDocumentBody`): shared artifact tabs.
      renderDocument: (tab, context) => {
        if (tab.kind !== 'path') {
          throw new Error(`The artifacts-only view has no body for a ${tab.kind} tab`);
        }
        return <CloudPathTabBody workItemId={item.id} tab={tab} context={context} />;
      },
      missingArtifactIds: new Set<string>(),
    }),
    [layoutKey, sharedIds, item.id]
  );

  const railScope = useMemo<RailScope>(
    () => ({ workItemId: item.id, layoutKey, worktreeId: null }),
    [item.id, layoutKey]
  );

  const model = headerModel({
    capabilities: SCOPED_CAPABILITIES,
    title: item.name,
    repoBadge: item.repo_name ?? '',
    shareUnavailableReason: null,
    ownerLabel: item.creator_name ?? item.creator_email,
    status: item.status,
    branch: null,
    prNumber: null,
    participants: [],
    viewers: [],
    selfId: null,
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkItemView
        source={source}
        paneHost={paneHost}
        header={() => (
          <WorkItemHeader
            model={model}
            viewers={[]}
            onShare={() => {
              throw new Error('An artifacts-only viewer has no Share');
            }}
          />
        )}
        rail={() => (
          <WorkItemRail scope={railScope}>
            <RailPanels
              signals={{}}
              counts={{}}
              renderPanel={(panel) => {
                if (panel !== 'work-item') {
                  throw new Error(`An artifacts-only viewer has no ${panel} panel`);
                }
                return <ScopedWorkItemPanel item={item} />;
              }}
            />
          </WorkItemRail>
        )}
        sessionBodies={NO_SESSION_BODIES}
        bodyProviders={passBodies}
      />
    </div>
  );
}
