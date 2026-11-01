import type { NotificationType } from '@chord/protocol';
import type { NotificationSettings } from '@shared/app-settings';
import type { NotificationPreference } from '@shared/notification-preferences';

/** The app-wide switches in Settings → Notifications. */
export type GlobalNotificationSettings = Pick<
  NotificationSettings,
  'enabled' | 'sound' | 'osNotifications' | 'soundFocusMode'
>;

export interface NotificationChannels {
  /** Listed in the bell and counted as unread. */
  inApp: boolean;
  /** A system banner. */
  desktop: boolean;
  sound: boolean;
}

/**
 * Which channels a notification reaches: its type's own switches, under the
 * app-wide ones. A system banner is for when Chord is in the background, as
 * the OS notifications switch says. A team invite has no row of its own: the
 * bell is where it is accepted, so it is always listed, and it never plays a
 * sound.
 */
export function channelsForNotification(
  type: NotificationType,
  preferences: NotificationPreference[],
  settings: GlobalNotificationSettings,
  appFocused: boolean
): NotificationChannels {
  const own =
    type === 'team_invite'
      ? { in_app: true, desktop: true, sound: false }
      : preferences.find((p) => p.notification_type === type);
  if (!own) throw new Error(`No notification preference for ${type}`);

  const bannerAllowed = settings.enabled && settings.osNotifications && !appFocused;
  const soundAllowed =
    settings.enabled && settings.sound && !(settings.soundFocusMode === 'unfocused' && appFocused);

  return {
    inApp: own.in_app,
    desktop: own.desktop && bannerAllowed,
    sound: own.sound && soundAllowed,
  };
}
