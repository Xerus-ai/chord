import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { log } from '@main/lib/logger';

/**
 * Whether main may talk to the sync server, from the version handshake
 * (devstation-mg6u.5). The minimum version guards a server change that breaks
 * older desktops, so an app turned away (update_required) must stop sending,
 * not only hide its window behind the update screen.
 *
 *   awaiting  boot, before the first completed reading: nothing is sent yet
 *   open      supported, or unknown (a failed read never blocks)
 *   paused    update_required; a later failed read keeps it paused
 *
 * The senders (sync queue, device socket, command inbox, git-state capture)
 * check isOpen() where they would reach the server and subscribe to resume.
 * Fed by DesktopCompatibilityMonitor after every completed check.
 */
type Gate = 'awaiting' | 'open' | 'paused';

class ServerTraffic {
  private gate: Gate = 'awaiting';
  private readonly listeners = new Set<(open: boolean) => void>();

  isOpen(): boolean {
    return this.gate === 'open';
  }

  apply(state: DesktopCompatibility): void {
    if (state.state === 'unknown' && !state.checked) return;
    let next: Gate;
    if (state.state === 'update_required') next = 'paused';
    else if (state.state === 'supported') next = 'open';
    else next = this.gate === 'paused' ? 'paused' : 'open';
    if (next === this.gate) return;
    this.gate = next;
    log.info(`[server-traffic] ${next}`);
    for (const listener of this.listeners) {
      try {
        listener(next === 'open');
      } catch (error) {
        log.error('[server-traffic] listener failed', { error: String(error) });
      }
    }
  }

  /** Called with true when traffic opens, false when it pauses. */
  subscribe(listener: (open: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const serverTraffic = new ServerTraffic();
