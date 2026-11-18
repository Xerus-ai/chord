import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { desktopCompatibilityChangedChannel } from '@shared/events/appEvents';
import { CHORD_SYNC_URL } from '@shared/urls';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { DesktopCompatibilityMonitor } from './desktop-compatibility';
import { appService } from './service';

/** How often a running app asks the sync server again (devstation-mg6u.2). */
const CHECK_INTERVAL_MS = 30 * 60_000;

/**
 * Asks the sync server at boot and every CHECK_INTERVAL_MS whether this app's
 * version is still supported, and tells the renderer when the answer changes.
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
  });
  private timer: ReturnType<typeof setInterval> | null = null;

  initialize(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  getState(): DesktopCompatibility {
    return this.monitor.getState();
  }

  private async check(): Promise<void> {
    const reading = await this.monitor.check();
    if (reading.state === 'unknown') log.info(`desktop compatibility not read: ${reading.reason}`);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const desktopCompatibilityService = new DesktopCompatibilityService();
