import {
  FEATURE_FLAGS,
  resolveFeatureFlags,
  type FeatureFlag,
  type FeatureFlags,
  type ServerHealth,
} from '@chord/protocol';
import { featureFlagsChangedChannel } from '@shared/events/appEvents';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';

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

/** Whether two sets of flags agree on every registered flag. */
function sameFlags(a: FeatureFlags, b: FeatureFlags): boolean {
  return (Object.keys(FEATURE_FLAGS) as FeatureFlag[]).every((flag) => a[flag] === b[flag]);
}

export class FeatureFlagsStore {
  private flags: FeatureFlags = resolveFeatureFlags(undefined);
  /** What the memory holds, so it is written only when the server's answer changes. */
  private remembered: FeatureFlags | null = null;

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
    this.remembered = kept;
    this.set(kept);
  }

  /** A /health answer: a server that sends no flags turns every flag off. */
  async apply(health: ServerHealth): Promise<void> {
    const next = resolveFeatureFlags(health.flags);
    this.set(next);
    if (this.remembered !== null && sameFlags(next, this.remembered)) return;
    await this.options.memory.save(next);
    this.remembered = next;
  }

  private set(next: FeatureFlags): void {
    if (sameFlags(next, this.flags)) return;
    this.flags = next;
    this.options.onChange(next);
  }
}

/** The app's flags: restored before the handshake starts, fed by each /health reading. */
export const featureFlagsStore = new FeatureFlagsStore({
  memory: settingsFlagsMemory,
  onChange: (flags) => events.emit(featureFlagsChangedChannel, flags),
});
