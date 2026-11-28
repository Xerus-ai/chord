import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { desktopCompatibilityChangedChannel } from '@shared/events/appEvents';
import { CHORD_SYNC_URL } from '@shared/urls';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { DesktopCompatibilityMonitor } from './desktop-compatibility';
import { settingsVerdictMemory } from './desktop-compatibility-memory';
import { featureFlagsStore } from './feature-flags';
import { serverTraffic } from './server-traffic';
import { appService } from './service';

/** How often a running app asks the sync server again. */
const CHECK_INTERVAL_MS = 30 * 60_000;
/** How often an app turned away, or not yet read, asks again: a lowered minimum reopens it soon. */
const PAUSED_CHECK_INTERVAL_MS = 2 * 60_000;

/**
 * Asks the sync server at boot and on an interval whether this app's version
 * is still supported, tells the renderer when the answer changes, and opens or
 * pauses main's own traffic to the server with each verdict.
 */
class DesktopCompatibilityService implements IInitializable, IDisposable {
  private readonly monitor = new DesktopCompatibilityMonitor({
    baseUrl: CHORD_SYNC_URL,
    currentVersion: () => appService.getCachedAppVersion(),
    onChange: (state) => {
      if (state.state === 'update_required') {
        log.warn(`desktop ${state.current} is below the sync server's minimum ${state.minimum}`);
      }
      events.emit(desktopCompatibilityChangedChannel, state);
    },
    onVerdict: (state) => serverTraffic.apply(state),
    intervals: { regular: CHECK_INTERVAL_MS, paused: PAUSED_CHECK_INTERVAL_MS },
    memory: settingsVerdictMemory,
    // The feature flags ride the same /health reading (devstation-mg6u.90).
    onHealth: (health) => featureFlagsStore.apply(health),
  });

  initialize(): void {
    // The kept flags first, so the first reading replaces them and never the other way round.
    // An unreadable memory is logged and the monitor starts anyway: every flag stays off, the
    // safe state, as with the verdict memory. Disposed meanwhile, the monitor's start is a no-op.
    void featureFlagsStore
      .restore()
      .catch((error: unknown) =>
        log.error('feature flags memory not read', { error: String(error) })
      )
      .then(() => this.monitor.start());
  }

  getState(): DesktopCompatibility {
    return this.monitor.getState();
  }

  dispose(): void {
    this.monitor.stop();
  }
}

export const desktopCompatibilityService = new DesktopCompatibilityService();
