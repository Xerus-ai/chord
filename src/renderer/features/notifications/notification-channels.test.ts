import { describe, expect, it } from 'vitest';
import type { NotificationPreference } from '@shared/notification-preferences';
import { channelsForNotification, type GlobalNotificationSettings } from './notification-channels';

function preference(
  type: string,
  channels: Partial<Pick<NotificationPreference, 'in_app' | 'desktop' | 'sound'>> = {}
): NotificationPreference {
  return {
    id: type,
    notification_type: type,
    in_app: channels.in_app ?? true,
    desktop: channels.desktop ?? true,
    sound: channels.sound ?? false,
  };
}

const ALL_ON: GlobalNotificationSettings = {
  enabled: true,
  sound: true,
  osNotifications: true,
  soundFocusMode: 'always',
};

const PREFERENCES = [
  preference('shared_with_you'),
  preference('mentioned', { sound: true }),
  preference('artifact_comment', { in_app: false, desktop: false }),
  preference('new_message', { desktop: false, sound: true }),
];

/**
 * Which channels a notification reaches (shared-items step 2, N4): the
 * type's own switches in Settings → Notifications, under the app-wide
 * Notifications, OS notifications and Sound switches. A system banner is for
 * when Chord is in the background, as the OS notifications switch says.
 */
describe('channelsForNotification', () => {
  it("follows the type's own switches", () => {
    expect(channelsForNotification('mentioned', PREFERENCES, ALL_ON, false)).toEqual({
      inApp: true,
      desktop: true,
      sound: true,
    });
    expect(channelsForNotification('artifact_comment', PREFERENCES, ALL_ON, false)).toEqual({
      inApp: false,
      desktop: false,
      sound: false,
    });
    expect(channelsForNotification('new_message', PREFERENCES, ALL_ON, false)).toEqual({
      inApp: true,
      desktop: false,
      sound: true,
    });
  });

  it('shows no system banner while Chord is focused', () => {
    expect(channelsForNotification('mentioned', PREFERENCES, ALL_ON, true).desktop).toBe(false);
  });

  it('shows no system banner with the OS notifications switch off', () => {
    const settings = { ...ALL_ON, osNotifications: false };
    expect(channelsForNotification('mentioned', PREFERENCES, settings, false).desktop).toBe(false);
  });

  it('plays no sound with the Sound switch off, or while focused under "unfocused" timing', () => {
    expect(
      channelsForNotification('mentioned', PREFERENCES, { ...ALL_ON, sound: false }, false).sound
    ).toBe(false);
    const unfocusedOnly = { ...ALL_ON, soundFocusMode: 'unfocused' as const };
    expect(channelsForNotification('mentioned', PREFERENCES, unfocusedOnly, true).sound).toBe(
      false
    );
    expect(channelsForNotification('mentioned', PREFERENCES, unfocusedOnly, false).sound).toBe(
      true
    );
  });

  it('with Notifications off, keeps the bell but drops banners and sound', () => {
    expect(
      channelsForNotification('mentioned', PREFERENCES, { ...ALL_ON, enabled: false }, false)
    ).toEqual({ inApp: true, desktop: false, sound: false });
  });

  it('always shows a team invite in the bell: it is where the invite is accepted', () => {
    expect(channelsForNotification('team_invite', PREFERENCES, ALL_ON, false)).toEqual({
      inApp: true,
      desktop: true,
      sound: false,
    });
    expect(channelsForNotification('team_invite', PREFERENCES, ALL_ON, true)).toEqual({
      inApp: true,
      desktop: false,
      sound: false,
    });
  });

  it('throws for a type the preferences do not list', () => {
    expect(() =>
      channelsForNotification('shared_with_you', [preference('mentioned')], ALL_ON, false)
    ).toThrow(/shared_with_you/);
  });
});
