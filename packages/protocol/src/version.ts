import { z } from 'zod';

/**
 * The version handshake: the sync server names the oldest
 * desktop app it still supports, and an app below it is told to update. An
 * installer that shipped without this check could never be told it is too old.
 */

/**
 * The oldest desktop version this server supports, sent on /health.
 * Raise it only once a desktop release that meets it is live on every update
 * channel (stable and canary): an app below it is blocked until it updates, so
 * a minimum with nothing to update to locks every user out. The order, and the
 * probe that proves the release is live: server/DEPLOYMENT.md section 7.
 * Versions compare in semver order, so a prerelease (canary, beta) of X.Y.Z
 * sorts below X.Y.Z and a minimum of X.Y.Z turns it away. When prereleases of
 * X.Y.Z carry the compatible client, write the first such prerelease
 * (X.Y.Z-canary.K, X.Y.Z-beta.K): it admits that one and every later one, and
 * X.Y.Z-0 would also admit prereleases cut before the change.
 */
export const MIN_DESKTOP_VERSION = '0.1.0';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** A semver string, or a ZodError naming it. */
export const SemverSchema = z.string().regex(SEMVER, 'not a semver version');

/**
 * The part of the /health body the handshake reads; other fields are ignored.
 * min_desktop_version is optional: a server deployed before the handshake does
 * not send it, and demands no minimum.
 */
export const ServerHealthSchema = z.object({
  status: z.string(),
  min_desktop_version: SemverSchema.optional(),
  /**
   * The release tag the server runs and its commit (devstation-5s42), null
   * outside a deploy; optional because servers before the deploy scripts do
   * not send them.
   */
  version: z.string().nullable().optional(),
  commit: z.string().nullable().optional(),
  /** Fixed per server process; changes on every restart. */
  epoch: z.string().optional(),
});
export type ServerHealth = z.infer<typeof ServerHealthSchema>;

function parse(version: string): { core: number[]; pre: string[] } {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`not a semver version: ${version}`);
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
  // A release sorts above any of its prereleases.
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== null || ny !== null) {
      // Numeric identifiers sort below alphanumeric ones.
      return nx !== null ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Semver precedence: negative when a < b, 0 when equal, positive when a > b.
 * For the app's own version (prereleases included). Agent CLI versions use the
 * plain X.Y.Z compareVersions in src/main/core/dependencies/version-compare.ts.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return comparePre(pa.pre, pb.pre);
}

/**
 * The server enforces the minimum too (devstation-mg6u.13): every signed-in
 * request names the client's version, REST in this header, a socket upgrade in
 * the query parameter below (a browser WebSocket cannot set headers). A request
 * that names none, an unreadable one or one below MIN_DESKTOP_VERSION is refused
 * with 426 and REFUSAL_UPDATE_REQUIRED, before any token work.
 */
export const CHORD_VERSION_HEADER = 'X-Chord-Version';
export const CHORD_VERSION_PARAM = 'chord_version';
export const REFUSAL_UPDATE_REQUIRED = 'update_required';

/** Whether a client naming `version` may use the API of a server whose minimum is `minimum`. */
export function isClientVersionAccepted(
  version: string | null | undefined,
  minimum: string
): boolean {
  if (!version || !SemverSchema.safeParse(version).success) return false;
  return compareVersions(version, minimum) >= 0;
}
