import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { CloudWorkItemRail } from '@renderer/features/right-rail/cloud-rail';
import { filePathTab } from '@renderer/features/work-list/center-tab';
import {
  closeCenterTab,
  openCenterTab,
  useCenterTabs,
  useOpenCenterTabs,
} from '@renderer/features/work-list/center-tabs-store';
import { CloudChatLauncherMenu } from '@renderer/features/work-list/cloud-chat-launcher-menu';
import { CloudPathTabBody } from '@renderer/features/work-list/cloud-path-tab-body';
import {
  offersDocumentTo,
  participantLayoutKey,
  type PaneHost,
} from '@renderer/features/work-list/pane-host';
import { useCloudSessionTabs } from '@renderer/features/work-list/use-cloud-session-tabs';
import { useParticipants } from '@renderer/features/work-list/use-participants';
import { useReconcileCenterTabs } from '@renderer/features/work-list/use-reconcile-center-tabs';
import { useWorkItemViewers } from '@renderer/features/work-list/use-viewing-presence';
import { resolveWorkItemCapabilities } from '@renderer/features/work-list/work-item-access';
import type { WorkItemSource } from '@renderer/features/work-list/work-item-source';
import { WorkItemView } from '@renderer/features/work-list/work-item-view';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import { StateCard } from '@renderer/lib/components/state-card';
import type { RoomJoinStatus } from '@renderer/lib/sync/room-registry';
import { useWorkItemRoom } from '@renderer/lib/sync/use-work-item-room';
import { CloudChatProvider } from './cloud-chat-context';
import { CloudChatThread } from './cloud-chat-thread';
import { cloudViewerAccess } from './cloud-viewer-access';
import { CloudWorkItemHeader } from './cloud-work-item-header';
import { roomGateOf } from './room-gate';
import { useCloudArtifactList } from './use-cloud-artifact-list';
import { useCloudArtifactListEvents } from './use-cloud-artifact-list-events';
import { useCloudGitState } from './use-cloud-git-state';
import { useLiveCallerRole } from './use-live-caller-role';

/**
 * A work item shared with this user, from the cloud: no checkout, no local
 * row. It renders through the same `WorkItemView` as the owner's; this is the
 * cloud source, and its gate on the work item's room. `onRevoked` is the
 * contract with the work list: access removed while viewing clears the
 * requested id, so the params-sync can never re-select the dead id.
 */
export function CloudWorkItemView({
  item,
  onRevoked,
}: {
  item: CloudWorkItem;
  onRevoked: () => void;
}) {
  const roomStatus = useWorkItemRoom(item.id);
  const gate = roomGateOf(roomStatus);

  useEffect(() => {
    if (gate === 'revoked') onRevoked();
  }, [gate, onRevoked]);

  if (gate === 'denied') {
    return (
      <StateCard
        badge="No access"
        tone="error"
        title="You don't have access to this work item"
        description="Ask the owner to share it with you, then open it again from the sidebar."
      />
    );
  }
  if (gate === 'revoked') {
    // Rendering the card INSTEAD of the content tree is what stops the
    // presence sender, viewers feed, and every other live hook: they unmount.
    return (
      <StateCard
        badge="Access revoked"
        tone="error"
        title="You no longer have access"
        description="The owner removed your access to this work item."
      />
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <CloudWorkItemContent item={item} roomStatus={roomStatus} />
    </div>
  );
}

/** The item's whole chat, while the owner has published no chat to give a tab. */
const renderItemChat = () => <CloudChatThread sessionId={null} />;

/**
 * Diff tabs read the owner's pushed snapshot, artifacts are the cloud
 * documents, and each of the owner's chats (the cloud session registry) is a
 * session tab over the item's one `CloudChatProvider` feed. The `+` reopens a
 * chat; closing a tab never ends the owner's session. Splits, drags and Open
 * to the Side are the viewer's own layout, persisted under
 * `participantLayoutKey` so it never mixes with an owner layout for the id.
 */
function CloudWorkItemContent({
  item,
  roomStatus,
}: {
  item: CloudWorkItem;
  roomStatus: RoomJoinStatus | null;
}) {
  const layoutKey = participantLayoutKey(item.id);
  const tabs = useCenterTabs(layoutKey);
  const openTabs = useOpenCenterTabs(layoutKey);
  const viewers = useWorkItemViewers(item.id);
  const sessionsById = useCloudSessionTabs(layoutKey, item.sessions);

  const { data: cloudArtifacts, isFetching: artifactsFetching } = useCloudArtifactList(item.id);
  useCloudArtifactListEvents(item.id);
  const artifactIds = useMemo(
    () => (cloudArtifacts && !artifactsFetching ? new Set(cloudArtifacts.map((a) => a.id)) : null),
    [cloudArtifacts, artifactsFetching]
  );
  const missingArtifactIds = useReconcileCenterTabs(tabs, { artifactIds, openTabs });

  const gitState = useCloudGitState(item.id);
  const { participants } = useParticipants(item.id);
  const owner = participants.find((p) => p.role === 'author');
  const ownerLabel = owner ? (owner.name ?? owner.email) : null;

  // Role and policy are live: a role change arrives as participant_role_changed,
  // a policy change folds into `item` (work_item_updated), and both re-resolve.
  const liveRole = useLiveCallerRole(item.id);
  const source = useMemo<WorkItemSource>(
    () => ({
      kind: 'cloud',
      item,
      scope: 'work_item',
      workItemId: item.id,
      layoutKey,
      capabilities: resolveWorkItemCapabilities(cloudViewerAccess(item, liveRole)),
    }),
    [item, layoutKey, liveRole]
  );

  const paneHost = useMemo<PaneHost>(
    () => ({
      layoutKey,
      offersDocument: offersDocumentTo(source.capabilities, null),
      sessions: {
        byId: sessionsById,
        close: (sessionId) => closeCenterTab(layoutKey, { kind: 'session', sessionId }),
        renderLauncher: () => (
          <CloudChatLauncherMenu
            layoutKey={layoutKey}
            sessions={item.sessions ?? []}
            worktrees={item.worktrees ?? []}
          />
        ),
        emptyLabel: 'No chat open. Open one from +',
      },
      // Only offered kinds reach here (`selectDocumentBody`): path tabs. The
      // diff annotates itself when a newer snapshot drops the open file.
      renderDocument: (tab, context) => {
        if (tab.kind !== 'path') {
          throw new Error(`The teammate view has no body for a ${tab.kind} tab`);
        }
        return <CloudPathTabBody workItemId={item.id} tab={tab} context={context} />;
      },
      missingArtifactIds,
    }),
    [
      layoutKey,
      item.id,
      item.sessions,
      item.worktrees,
      sessionsById,
      source.capabilities,
      missingArtifactIds,
    ]
  );

  const sessionBodies = useMemo(
    () => ({
      byId: sessionsById,
      render: (session: { id: string }) => <CloudChatThread sessionId={session.id} />,
    }),
    [sessionsById]
  );
  const bodyProviders = useCallback(
    (bodies: ReactNode) => (
      <CloudChatProvider workItemId={item.id} roomStatus={roomStatus}>
        {bodies}
      </CloudChatProvider>
    ),
    [item.id, roomStatus]
  );

  return (
    <WorkItemView
      source={source}
      paneHost={paneHost}
      header={(focused) => (
        <CloudWorkItemHeader
          item={item}
          participants={participants}
          viewers={viewers}
          activeArtifactId={focused?.kind === 'path' ? (focused.artifactId ?? null) : null}
        />
      )}
      rail={(focused) => (
        <CloudWorkItemRail
          item={item}
          ownerLabel={ownerLabel}
          gitState={gitState.data}
          gitStatePending={gitState.isPending}
          gitStateError={!!gitState.error}
          viewers={viewers}
          // The rail's changes list selects the focused diff.
          selectedFile={
            focused?.kind === 'path' && focused.mode === 'diff' ? (focused.filePath ?? null) : null
          }
          onFileSelect={(filePath) =>
            openCenterTab(layoutKey, filePathTab(filePath, { mode: 'diff' }), { preview: true })
          }
        />
      )}
      sessionBodies={sessionBodies}
      renderWorkItemChat={sessionsById.size > 0 ? undefined : renderItemChat}
      bodyProviders={bodyProviders}
    />
  );
}
