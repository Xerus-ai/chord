import type { NotificationType } from '@chord/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { NotificationPreference } from '@shared/notification-preferences';
import { appSettingsMetaQuery } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { channelsForNotification, type NotificationChannels } from './notification-channels';

/** Settings → Notifications' per-type switches; Settings invalidates it on every change. */
export const NOTIFICATION_PREFERENCES_KEY = ['notificationPreferences'] as const;

const notificationPreferencesQuery = {
  queryKey: NOTIFICATION_PREFERENCES_KEY,
  queryFn: async (): Promise<NotificationPreference[]> => {
    const result = await rpc.notificationPreferences.getAll();
    if (!result.success) throw new Error('notificationPreferences.getAll failed');
    return result.data.preferences;
  },
  staleTime: Infinity,
};

/**
 * Which channels each notification reaches (`channelsForNotification`), from
 * the per-type switches and the app-wide ones.
 * - `isListed` decides the bell and the unread count; null until both are read.
 * - `resolveChannels` is for a notification as it arrives: it waits for both
 *   reads, so a frame that lands first is neither dropped nor shown against
 *   switches the user turned off.
 */
export function useNotificationChannels(): {
  isListed: ((type: NotificationType) => boolean) | null;
  resolveChannels: (type: NotificationType) => Promise<NotificationChannels>;
} {
  const queryClient = useQueryClient();
  const { data: preferences } = useQuery(notificationPreferencesQuery);
  const { data: settingsMeta } = useQuery(appSettingsMetaQuery('notifications'));

  const isListed = useMemo(() => {
    if (!preferences || !settingsMeta) return null;
    return (type: NotificationType) =>
      channelsForNotification(type, preferences, settingsMeta.value, document.hasFocus()).inApp;
  }, [preferences, settingsMeta]);

  const resolveChannels = useCallback(
    async (type: NotificationType) => {
      const [latestPreferences, latestSettings] = await Promise.all([
        queryClient.ensureQueryData(notificationPreferencesQuery),
        queryClient.ensureQueryData(appSettingsMetaQuery('notifications')),
      ]);
      return channelsForNotification(
        type,
        latestPreferences,
        latestSettings.value,
        document.hasFocus()
      );
    },
    [queryClient]
  );

  return { isListed, resolveChannels };
}
