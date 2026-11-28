import {
  compareVersions,
  SemverSchema,
  ServerHealthSchema,
  type ServerHealth,
} from '@chord/protocol';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import { log } from '@main/lib/logger';

/**
 * The desktop half of the version handshake: read the sync server's /health
 * and compare this app's version with the minimum it names.
 */

/** A periodic check: nothing waits on it. */
const TIMEOUT_MS = 10_000;
/**
 * The first reading: the window shows a blank placeholder until it completes,
 * so a network that drops requests silently must not hold it for long.
 */
const FIRST_READING_TIMEOUT_MS = 3_000;

export async function readDesktopCompatibility(
  baseUrl: string,
  current: string,
  timeoutMs = TIMEOUT_MS,
  onHealth?: (health: ServerHealth) => void | Promise<void>
): Promise<DesktopCompatibility> {
  if (!SemverSchema.safeParse(current).success) {
    return {
      state: 'unknown',
      checked: true,
      reason: `this app's version is unreadable: ${current}`,
    };
  }
  let res: Response;
  try {
    // Relative to the base with a trailing slash, so a path prefix in it is kept.
    const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    res = await fetch(new URL('health', root), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    return { state: 'unknown', checked: true, reason: `sync server unreachable: ${String(error)}` };
  }
  if (!res.ok) {
    return {
      state: 'unknown',
      checked: true,
      reason: `sync server /health answered ${res.status}`,
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    return {
      state: 'unknown',
      checked: true,
      reason: `sync server /health is not JSON: ${String(error)}`,
    };
  }
  const health = ServerHealthSchema.safeParse(body);
  if (!health.success) {
    return {
      state: 'unknown',
      checked: true,
      reason: `sync server /health: ${health.error.message}`,
    };
  }
  if (onHealth) {
    try {
      await onHealth(health.data);
    } catch (error) {
      // A reader of the answer (the feature flags) must not change the verdict.
      log.error('sync server /health reader failed', { error: String(error) });
    }
  }
  const minimum = health.data.min_desktop_version ?? null;
  // Semver order: a prerelease sorts below its release, so a minimum admits a
  // prerelease of that version only when it names one (see MIN_DESKTOP_VERSION).
  if (minimum !== null && compareVersions(current, minimum) < 0) {
    return { state: 'update_required', current, minimum };
  }
  return { state: 'supported', current, minimum };
}

/** Where the minimum that last turned this app away is kept between launches. */
export interface VerdictMemory {
  load(): Promise<string | null>;
  /** The minimum of an update_required verdict, or null once the server lets the app in. */
  save(requiredMinimum: string | null): Promise<void>;
}

export interface DesktopCompatibilityMonitorOptions {
  baseUrl: string;
  currentVersion: () => Promise<string>;
  /** Each change of the verdict kept, and the first completed reading. */
  onChange: (state: DesktopCompatibility) => void;
  /** After every completed check, with the verdict kept (what drives server traffic). */
  onVerdict: (state: DesktopCompatibility) => void;
  /**
   * The wait between checks once started: `regular` while supported, `paused`
   * otherwise. Turned away, a lowered minimum lets the app back in soon; never
   * read (a first reading that timed out on a slow boot or network), the
   * verdict it let through is asked for again soon, not half an hour later.
   */
  intervals: { regular: number; paused: number };
  /**
   * The last verdict that turned this app away, kept across launches: relaunched
   * with the server out of reach, an app below it starts turned away instead of
   * reading unknown, which would open its traffic to the server.
   */
  memory: VerdictMemory;
  /** Each /health answer read, for what else rides it (the feature flags, devstation-mg6u.90). */
  onHealth?: (health: ServerHealth) => void | Promise<void>;
}

/**
 * Holds the verdict and reports each change. A reading that fails (unknown)
 * never replaces a verdict the server already gave: an app told to update stays
 * told until the server says otherwise, and going offline does not let it in.
 */
export class DesktopCompatibilityMonitor {
  private state: DesktopCompatibility = {
    state: 'unknown',
    checked: false,
    reason: 'not checked yet',
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** What the memory holds, so it is written only when the server's word changes. */
  private remembered: string | null = null;

  constructor(private readonly options: DesktopCompatibilityMonitorOptions) {}

  getState(): DesktopCompatibility {
    return this.state;
  }

  /**
   * Applies the remembered verdict, checks now, then again after each interval
   * until stop(). Resolves once the first check is done.
   */
  async start(): Promise<void> {
    this.running = true;
    try {
      await this.restore();
    } catch (error) {
      // Unreadable, the memory holds nothing: the checks still run, as before it existed.
      // Failing closed would hold every sender until a reading arrived, and for good
      // while the server is out of reach.
      log.error('desktop compatibility memory not read', { error: String(error) });
    }
    await this.checkAndSchedule();
  }

  /** A remembered minimum the current version is still below turns the app away before any reading. */
  private async restore(): Promise<void> {
    this.remembered = await this.options.memory.load();
    if (this.remembered === null) return;
    const current = await this.options.currentVersion();
    // A version the app cannot read is never turned away: nothing says which would be let in.
    if (!SemverSchema.safeParse(current).success) return;
    if (compareVersions(current, this.remembered) >= 0) return;
    this.state = { state: 'update_required', current, minimum: this.remembered };
    this.options.onChange(this.state);
    this.options.onVerdict(this.state);
  }

  /** The server's word is remembered; a failed reading (unknown) changes nothing. */
  private async remember(state: DesktopCompatibility): Promise<void> {
    if (state.state === 'unknown') return;
    const next = state.state === 'update_required' ? state.minimum : null;
    if (next === this.remembered) return;
    await this.options.memory.save(next);
    this.remembered = next;
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Reads the server once; returns that reading, which may differ from the state kept. */
  async check(): Promise<DesktopCompatibility> {
    // The first completed reading is always reported: it is what lets the
    // renderer leave its placeholder, even when it is unknown.
    const first = this.state.state === 'unknown' && !this.state.checked;
    let reading: DesktopCompatibility;
    try {
      reading = await readDesktopCompatibility(
        this.options.baseUrl,
        await this.options.currentVersion(),
        first ? FIRST_READING_TIMEOUT_MS : TIMEOUT_MS,
        this.options.onHealth
      );
    } catch (error) {
      reading = {
        state: 'unknown',
        checked: true,
        reason: `this app's version could not be read: ${String(error)}`,
      };
    }
    const keep = reading.state === 'unknown' && this.state.state !== 'unknown';
    if (!keep) {
      const changed =
        first ||
        reading.state !== this.state.state ||
        (reading.state !== 'unknown' && JSON.stringify(reading) !== JSON.stringify(this.state));
      this.state = reading;
      if (changed) this.options.onChange(reading);
    }
    this.options.onVerdict(this.state);
    await this.remember(this.state);
    return reading;
  }

  private async checkAndSchedule(): Promise<void> {
    const first = this.state.state === 'unknown' && !this.state.checked;
    let reading: DesktopCompatibility | null = null;
    try {
      reading = await this.check();
      if (reading.state === 'unknown')
        log.info(`desktop compatibility not read: ${reading.reason}`);
    } catch (error) {
      // A listener that throws must not end the schedule: the next check still runs.
      log.error('desktop compatibility check failed', { error: String(error) });
    }
    if (!this.running) return;
    const { regular, paused } = this.options.intervals;
    // A first reading that failed may only have hit its short timeout (a cold
    // boot keeps the event loop busy for seconds): asked again at once, with
    // the full timeout, so an app below the minimum is turned away seconds
    // after the window opens rather than one paused interval later.
    const wait =
      first && reading?.state !== 'supported' && reading?.state !== 'update_required'
        ? 0
        : this.state.state === 'supported'
          ? regular
          : paused;
    this.timer = setTimeout(() => void this.checkAndSchedule(), wait);
    this.timer.unref?.();
  }
}
