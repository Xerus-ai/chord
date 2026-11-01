import type { CloudCommand, CloudPermissionRequest, CloudPlanRequest } from '@chord/protocol';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { RoomJoinStatus } from '@renderer/lib/sync/room-registry';
import { metadataOf } from './participant-timeline';
import { useCloudChat, type CloudChatFeed } from './use-cloud-chat';
import { useCommandStatuses, type CommandStatusEntry } from './use-command-statuses';
import { usePermissionRequests } from './use-permission-requests';
import { usePlanRequests } from './use-plan-requests';

interface CloudChatContextValue {
  feed: CloudChatFeed;
  roomStatus: RoomJoinStatus | null;
  /** Delivery of the prompts sent as commands, for their rows' chips. */
  statuses: ReadonlyMap<string, CommandStatusEntry>;
  recordCommand: (command: CloudCommand) => void;
  /** What the agent asks, for the item; each chat shows its own (`selectThreadRequests`). */
  permissionRequests: readonly CloudPermissionRequest[];
  planRequests: readonly CloudPlanRequest[];
}

const CloudChatContext = createContext<CloudChatContextValue | null>(null);

/**
 * A teammate's chat feed for one work item, above the panes, as
 * `TurnStreamProvider` is for the owner: every chat tab is a selection of
 * this one feed, so a tab opened, split or moved shows the rows already
 * loaded and never opens a second subscription. The agent's permission and
 * plan requests are here for the same reason.
 */
export function CloudChatProvider({
  workItemId,
  roomStatus,
  children,
}: {
  workItemId: string;
  roomStatus: RoomJoinStatus | null;
  children: ReactNode;
}) {
  const feed = useCloudChat(workItemId);
  const { statuses, recordCommand } = useCommandStatuses(workItemId);
  const permissionRequests = usePermissionRequests(workItemId);
  const planRequests = usePlanRequests(workItemId);
  const { messages, hydrateMessages } = feed;

  // Fetch the full row for every agent_turn the list endpoint trimmed, so
  // their turns appear once the metadata lands (buildCloudTranscript skips
  // them until then). One batched call for the whole set — a seed of up to
  // PAGE_SIZE trimmed rows must not become one request per row (see
  // hydrateMessages). hydrateMessages' own in-flight set makes repeat calls
  // for an id already in flight a no-op, so this doesn't need its own dedup.
  useEffect(() => {
    const truncatedIds = messages
      .filter((message) => message.message_type === 'agent_turn' && metadataOf(message).truncated)
      .map((message) => message.id);
    if (truncatedIds.length > 0) hydrateMessages(truncatedIds);
  }, [messages, hydrateMessages]);

  const value = useMemo(
    () => ({ feed, roomStatus, statuses, recordCommand, permissionRequests, planRequests }),
    [feed, roomStatus, statuses, recordCommand, permissionRequests, planRequests]
  );
  return <CloudChatContext.Provider value={value}>{children}</CloudChatContext.Provider>;
}

export function useCloudChatContext(): CloudChatContextValue {
  const value = useContext(CloudChatContext);
  if (!value) throw new Error('useCloudChatContext must be rendered inside CloudChatProvider');
  return value;
}
