import { describe, expect, it, vi } from 'vitest';
import { notificationPreferencesController } from './controller';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

async function listPreferences() {
  const result = await notificationPreferencesController.getAll();
  if (!result.success) throw new Error('getAll failed');
  return result.data.preferences;
}

/**
 * Settings → Notifications lists a row per notification the cloud sends
 * (shared-items step 2, N4), each on by default in the bell and as a banner.
 */
describe('notificationPreferencesController', () => {
  it('lists the shared-items types with their defaults', async () => {
    const preferences = await listPreferences();
    for (const type of ['shared_with_you', 'mentioned', 'artifact_comment', 'new_message']) {
      expect(preferences).toContainEqual({
        id: type,
        notification_type: type,
        in_app: true,
        desktop: true,
        sound: false,
      });
    }
  });

  it('keeps what a switch was set to', async () => {
    await notificationPreferencesController.update({
      notificationType: 'artifact_comment',
      inApp: false,
      desktop: false,
      sound: true,
    });

    const preferences = await listPreferences();
    expect(preferences.find((p) => p.notification_type === 'artifact_comment')).toEqual({
      id: 'artifact_comment',
      notification_type: 'artifact_comment',
      in_app: false,
      desktop: false,
      sound: true,
    });
  });

  it('refuses a type it does not list', async () => {
    await expect(
      notificationPreferencesController.update({
        notificationType: 'no_such_type',
        inApp: true,
        desktop: true,
        sound: true,
      })
    ).rejects.toThrow(/no_such_type/);
  });
});
