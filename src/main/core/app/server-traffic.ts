import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { log } from '@main/lib/logger';

/**
 * Whether main may start a request to the sync server, from the version
 * handshake. The minimum version guards a server change that breaks older
 * desktops, so an app turned away (update_required) must stop sending, not
 * only hide its window behind the update screen.
 *
 *   awaiting  from hold() (the app's boot, before its senders start) until the
 *             first completed reading: no sender starts a request
 *   open      the default; supported, or unknown (a failed read never blocks)
 *   paused    update_required
 *
 * The gate is checked before a request starts. A cycle already past its check
 * when the gate closes finishes the reads it is in (an org lookup, a listing, a
 * page walk); the sync queue sends no further row and cloudFetch refuses every
 * new request.
 *
 * The senders (sync queue, device socket, command inbox, git-state capture)
 * check isOpen() where they would reach the server and subscribe to resume.
 * Fed by the desktop compatibility service after every completed check.
 */
type Gate = 'awaiting' | 'open' | 'paused';

/** A request to the sync server refused because traffic is held or paused. */
export class ServerTrafficPausedError extends Error {
  constructor(path: string) {
    super(`sync server traffic is paused (version check): ${path}`);
    this.name = 'ServerTrafficPausedError';
  }
}

class ServerTraffic {
  private gate: Gate = 'open';
  private readonly listeners = new Set<(open: boolean) => void>();

  isOpen(): boolean {
    return this.gate === 'open';
  }

  /**
   * Boot: send nothing until the first completed reading. Called by
   * startServerSenders before the senders start; code with no version check
   * (scripts, tests of a sender) keeps the default, open.
   */
  hold(): void {
    if (this.gate === 'open') this.gate = 'awaiting';
  }

  /**
   * `state` is the verdict the monitor keeps, which stays update_required
   * through failed reads (the monitor never lets one replace a verdict), so
   * update_required pauses and anything else completed opens.
   */
  apply(state: DesktopCompatibility): void {
    if (state.state === 'unknown' && !state.checked) return;
    const next: Gate = state.state === 'update_required' ? 'paused' : 'open';
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

  /** Called with true when traffic opens, false when it pauses; returns the unsubscribe. */
  subscribe(listener: (open: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const serverTraffic = new ServerTraffic();
