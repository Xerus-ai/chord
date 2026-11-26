import { resolveFeatureFlags, type ServerHealth } from '@chord/protocol';
import type { FeatureFlags } from '@shared/feature-flags';
import { appSettingsService } from '@main/core/settings/settings-service';

/**
 * Feature flags in main (devstation-mg6u.90): the sync server's /health names which flags are on
 * (read by the version handshake's monitor); the last answer is kept in the app settings, so an
 * offline relaunch shows what the server last said. Before any answer every flag is off.
 */

/** Where the last served flags are kept between launches. */
export interface FlagsMemory {
  load(): Promise<FeatureFlags | null>;
  save(flags: FeatureFlags): Promise<void>;
}

export const settingsFlagsMemory: FlagsMemory = {
  load: async () => {
    const { served } = await appSettingsService.get('featureFlags');
    return served === null ? null : resolveFeatureFlags(served);
  },
  save: async (flags) => {
    await appSettingsService.update('featureFlags', { served: flags });
  },
};

export class FeatureFlagsStore {
  private flags: FeatureFlags = resolveFeatureFlags(undefined);
  /** What the memory holds, so it is written only when the server's answer changes. */
  private remembered: string | null = null;

  constructor(
    private readonly options: { memory: FlagsMemory; onChange: (flags: FeatureFlags) => void }
  ) {}

  get(): FeatureFlags {
    return this.flags;
  }

  /** The last served flags, before the first reading of this launch. */
  async restore(): Promise<void> {
    const kept = await this.options.memory.load();
    if (kept === null) return;
    this.remembered = JSON.stringify(kept);
    this.set(kept);
  }

  /** A /health answer: a server that sends no flags turns every flag off. */
  async apply(health: ServerHealth): Promise<void> {
    const next = resolveFeatureFlags(health.flags);
    this.set(next);
    const key = JSON.stringify(next);
    if (key === this.remembered) return;
    await this.options.memory.save(next);
    this.remembered = key;
  }

  private set(next: FeatureFlags): void {
    if (JSON.stringify(next) === JSON.stringify(this.flags)) return;
    this.flags = next;
    this.options.onChange(next);
  }
}
