import { createRPCController } from '@/shared/ipc/rpc';
import { INTERNAL_SETTINGS_KEYS } from './settings-registry';
import { appSettingsService, type AppSettings, type AppSettingsKey } from './settings-service';

/** The renderer writes preferences only; main keeps the internal keys (devstation-mg6u.98). */
function preference(key: AppSettingsKey): void {
  if (INTERNAL_SETTINGS_KEYS.has(key)) {
    throw new Error(`settings key ${key} is kept by main and cannot be written from the renderer`);
  }
}

export const appSettingsController = createRPCController({
  get: <T extends AppSettingsKey>(key: T): Promise<AppSettings[T]> => appSettingsService.get(key),

  getAll: (): Promise<AppSettings> => appSettingsService.getAll(),

  getWithMeta: <T extends AppSettingsKey>(
    key: T
  ): Promise<{
    value: AppSettings[T];
    defaults: AppSettings[T];
    overrides: Partial<AppSettings[T]>;
  }> => appSettingsService.getWithMeta(key),

  update: async <T extends AppSettingsKey>(key: T, value: AppSettings[T]): Promise<void> => {
    preference(key);
    await appSettingsService.update(key, value);
  },

  reset: async <T extends AppSettingsKey>(key: T): Promise<void> => {
    preference(key);
    await appSettingsService.reset(key);
  },

  resetField: async <T extends AppSettingsKey>(key: T, field: string): Promise<void> => {
    preference(key);
    await appSettingsService.resetField(key, field as keyof AppSettings[T]);
  },
});
