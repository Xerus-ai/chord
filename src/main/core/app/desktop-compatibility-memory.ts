import { appSettingsService } from '@main/core/settings/settings-service';
import type { VerdictMemory } from './desktop-compatibility';

/** The minimum that last turned this app away, kept in the local app settings. */
export const settingsVerdictMemory: VerdictMemory = {
  load: async () => (await appSettingsService.get('desktopCompatibility')).requiredMinimum,
  save: async (requiredMinimum) => {
    await appSettingsService.update('desktopCompatibility', { requiredMinimum });
  },
};
