import { describe, expect, it, vi } from 'vitest';

/**
 * Internal settings (devstation-mg6u.98): `featureFlags` and `desktopCompatibility` are the sync
 * server's last word, kept by main, not preferences. The bugs these catch: the renderer's
 * generic settings RPC overwriting them (turning a flag on, or letting an app the server turned
 * away back in offline), and a corrupt stored row handed to main as if it were valid. The real
 * settings store on a migrated test database.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { appSettings } = await import('@main/db/schema');
const { appSettingsController } = await import('./controller');
const { SettingsStore, appSettingsService } = await import('./settings-service');

describe('internal settings', () => {
  it('the settings RPC refuses to write featureFlags and desktopCompatibility', async () => {
    await expect(
      appSettingsController.update('featureFlags', { served: { whats_new: true } })
    ).rejects.toThrow(/featureFlags/);
    await expect(
      appSettingsController.update('desktopCompatibility', { requiredMinimum: null })
    ).rejects.toThrow(/desktopCompatibility/);
    await expect(appSettingsController.reset('featureFlags')).rejects.toThrow(/featureFlags/);
    await expect(
      appSettingsController.resetField('desktopCompatibility', 'requiredMinimum')
    ).rejects.toThrow(/desktopCompatibility/);
    expect((await appSettingsService.get('featureFlags')).served).toBeNull();
  });

  it('a preference still goes through the settings RPC', async () => {
    await appSettingsController.update('sharing', { defaultWorkItemAccess: 'invited' });
    expect((await appSettingsService.get('sharing')).defaultWorkItemAccess).toBe('invited');
  });

  it('an invalid stored row of an internal key throws naming the key', async () => {
    await db
      .insert(appSettings)
      .values({ key: 'featureFlags', value: JSON.stringify({ served: { whats_new: 'yes' } }) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify({ served: { whats_new: 'yes' } }) },
      })
      .execute();
    await expect(new SettingsStore().get('featureFlags')).rejects.toThrow(/featureFlags/);
  });

  // A bad internal row must not stop the app at boot: its owner logs it and keeps the safe state.
  it('boot still loads the preferences when an internal row is invalid', async () => {
    await db
      .insert(appSettings)
      .values({ key: 'desktopCompatibility', value: JSON.stringify({ requiredMinimum: 7 }) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify({ requiredMinimum: 7 }) },
      })
      .execute();
    const store = new SettingsStore();
    await expect(store.initialize()).resolves.toBeUndefined();
    expect((await store.get('sharing')).defaultWorkItemAccess).toBe('invited');
  });
});
