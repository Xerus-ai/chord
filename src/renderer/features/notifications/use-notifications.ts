import type { NotificationView } from '@chord/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParticipantRosters } from '@renderer/features/dashboard/use-dashboard-data';
import { cloudApi } from '@renderer/lib/cloud-api';
import type { AvatarStackMember } from '@renderer/lib/components/chrome/avatar-stack';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { log } from '@renderer/utils/logger';
import { playNotificationChime } from '@renderer/utils/soundPlayer';
import { notificationFromChatMessage } from './chat-notification';
import { describeNotification, notificationPlainText } from './describe-notification';
import { mergeNotifications } from './notification-history';
import { loadReadNotificationIds, saveReadNotificationIds } from './read-notifications-store';
import { useNotificationChannels } from './use-notification-channels';

/** The persisted history is server-owned data — TanStack Query, per AGENTS.md. */
const NOTIFICATIONS_KEY = ['notifications'] as const;

export function useNotifications() {
  const { subscribeEvent } = useSyncSocketContext();
  const { data: session } = useAccountSession();
  const queryClient = useQueryClient();
  const { currentView } = useWorkspaceSlots();
  const { params: workListParams } = useParams('work-list');
  // Live WS frames only. The durable history is seeded from the server query
  // below; the two are merged (deduped by id) into the exported list.
  const [liveNotifications, setLiveNotifications] = useState<NotificationView[]>([]);
  const { isListed, resolveChannels } = useNotificationChannels();

  const selfUserId = session?.user?.userId ?? null;

  // Server truth: the persisted rows carry the authoritative `read` state, so
  // a notification acted on elsewhere (another device, or via accept/decline)
  // no longer lingers unread here, and reloads no longer drop history.
  const { data: serverNotifications } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => cloudApi.getNotifications(),
    enabled: selfUserId != null,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Read state outlives this hook: a notification dismissed before a reload
  // used to come back unread when the server redelivered it.
  const readIdsRef = useRef<Set<string> | null>(null);
  if (readIdsRef.current === null) {
    readIdsRef.current = readStoredNotificationIds();
  }
  const desktopPermissionAskedRef = useRef(false);

  // Server truth merged with live frames (notification-history.ts). The
  // localStorage read-set is applied where it's written (`deliver` for live
  // frames) and the optimistic markAsRead paths, never re-read during render.
  // A type whose in-app switch is off is neither listed nor counted; nothing
  // is listed until the switches have been read.
  const notifications = useMemo(
    () =>
      isListed === null
        ? []
        : mergeNotifications(serverNotifications ?? [], liveNotifications).filter((n) =>
            isListed(n.type)
          ),
    [serverNotifications, liveNotifications, isListed]
  );

  // Derived, never a second counter — the two used to drift whenever a
  // notification arrived already read.
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markReadIds = useCallback((ids: string[]) => {
    readIdsRef.current = saveReadNotificationIds(
      localStorage,
      readIdsRef.current ?? new Set(),
      ids
    );
  }, []);

  // Ownership is decided against the local authoritative list, never the
  // payload — only items this machine owns get chat surfacing. The names are
  // what the chat notification's sentence names.
  const { data: ownedItemsData } = useQuery({
    queryKey: ['workItems', 'local-names'],
    queryFn: async () => {
      const result = await rpc.workItems.getAll();
      if (!result.success) throw new Error('workItems.getAll failed');
      return result.data.items.map((item) => [item.id, item.name] as const);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Long-lived subscription handlers read these via refs — resubscribing the
  // socket on every render would open gaps where messages are missed.
  const viewingWorkItemId =
    currentView === 'work-list' ? (workListParams.workItemId ?? null) : null;
  // Who each owned item is shared with: a chat notification names its sender
  // from here, never from the message's sender_name (the email).
  const rosters = useParticipantRosters();
  const chatContextRef = useRef({
    selfUserId: null as string | null,
    ownedItems: new Map<string, string>(),
    rosters: new Map<string, AvatarStackMember[]>(),
    viewingWorkItemId: null as string | null,
  });
  useEffect(() => {
    chatContextRef.current = {
      selfUserId,
      ownedItems: new Map(ownedItemsData ?? []),
      rosters,
      viewingWorkItemId,
    };
  }, [selfUserId, ownedItemsData, rosters, viewingWorkItemId]);

  // The banner and the sound follow their switches as they are when the
  // notification arrives (Settings → Notifications).
  const deliver = useCallback(
    (notification: NotificationView) => {
      const alreadyRead = readIdsRef.current?.has(notification.id) === true;
      setLiveNotifications((prev) => [{ ...notification, read: alreadyRead }, ...prev]);
      if (alreadyRead) return;

      void resolveChannels(notification.type)
        .then((channels) => {
          if (channels.desktop) showDesktopNotification(notification, desktopPermissionAskedRef);
          if (channels.sound) playNotificationChime();
        })
        .catch((error) => log.error('notifications: could not read notification settings', error));
    },
    [resolveChannels]
  );

  useEffect(() => {
    return subscribeEvent('notification_received', deliver);
  }, [subscribeEvent, deliver]);

  // A notification sent while the socket was down never arrives live: the
  // history is read again on every (re)connect instead of at the next poll.
  useEffect(() => {
    return subscribeEvent('$sync/connected', () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    });
  }, [subscribeEvent, queryClient]);

  // Owner-side surfacing of participant chat: until the owner chat panel
  // renders cloud messages inline, this is the only signal that a teammate
  // wrote into an owned session. Interim by design; post-wiring it remains
  // the not-in-room signal. Content renders as text — never HTML.
  useEffect(() => {
    return subscribeEvent('chat_message_received', (message) => {
      const { selfUserId, ownedItems, rosters, viewingWorkItemId } = chatContextRef.current;
      const workItemName = ownedItems.get(message.work_item_id);
      if (workItemName === undefined) return;
      if (message.sender_id !== null && message.sender_id === selfUserId) return;
      if (message.work_item_id === viewingWorkItemId) return;
      if (message.content.trim().length === 0) return;
      const notification = notificationFromChatMessage(message, {
        workItemName,
        roster: rosters.get(message.work_item_id) ?? [],
      });
      if (notification) deliver(notification);
    });
  }, [subscribeEvent, deliver]);

  // Optimistic locally (read-set + live frames + server cache), then persisted
  // to the server so the truth survives a reload and reaches other devices. A
  // persist failure is loud but non-fatal — the next refetch reconciles.
  const markAsRead = useCallback(
    (id: string) => {
      markReadIds([id]);
      setLiveNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      queryClient.setQueryData<NotificationView[]>(NOTIFICATIONS_KEY, (old) =>
        old?.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      void cloudApi
        .markNotificationRead(id)
        .catch((err) => log.error('notifications: failed to persist read', err))
        .finally(() => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }));
    },
    [markReadIds, queryClient]
  );

  const markAllAsRead = useCallback(() => {
    markReadIds(notifications.map((n) => n.id));
    setLiveNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    queryClient.setQueryData<NotificationView[]>(NOTIFICATIONS_KEY, (old) =>
      old?.map((n) => ({ ...n, read: true }))
    );
    void cloudApi
      .markAllNotificationsRead()
      .catch((err) => log.error('notifications: failed to persist read-all', err))
      .finally(() => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }));
  }, [markReadIds, notifications, queryClient]);

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}

/**
 * Nothing but this app writes the key, so unreadable content means it was
 * tampered with or truncated. That is reported, not hidden — but it must not
 * take the whole shell down over which alerts were already dismissed.
 */
function readStoredNotificationIds(): Set<string> {
  try {
    return loadReadNotificationIds(localStorage);
  } catch (error) {
    log.error('notifications: stored read state was unreadable, resetting', error);
    return saveReadNotificationIds(localStorage, new Set(), []);
  }
}

/**
 * The OS permission is asked for on the first notification that actually
 * arrives — the first moment there is something concrete to ask about. Asking
 * at boot gets refused by reflex, and `Notification.permission` never leaving
 * 'default' is why no desktop notification has ever been shown.
 */
function showDesktopNotification(
  notification: NotificationView,
  permissionAskedRef: { current: boolean }
): void {
  if (typeof globalThis.Notification === 'undefined') return;

  const { title, body } = notificationPlainText(describeNotification(notification));
  const show = () => new Notification(title, { body: body ?? undefined, tag: notification.id });

  if (Notification.permission === 'granted') {
    show();
    return;
  }
  if (Notification.permission === 'denied' || permissionAskedRef.current) return;

  permissionAskedRef.current = true;
  void Notification.requestPermission().then((permission) => {
    if (permission === 'granted') show();
  });
}
