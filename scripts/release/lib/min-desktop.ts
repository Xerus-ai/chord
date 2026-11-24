import { parseReleaseTag } from './release-plan.ts';

/**
 * MIN_DESKTOP_VERSION (packages/protocol/src/version.ts) as release.yml reads it: the oldest
 * desktop app the server lets in. A server release that raises it deploys only once every
 * channel serves a desktop release that meets it (server/DEPLOYMENT.md section 7).
 */

/** The minimum a version.ts source declares; throws when it declares none. */
export function readMinDesktopVersion(source: string): string {
  const m = /export const MIN_DESKTOP_VERSION = '([^']+)';/.exec(source);
  if (!m) throw new Error('packages/protocol/src/version.ts declares no MIN_DESKTOP_VERSION');
  return m[1];
}

/** Release versions rank by X.Y.Z, and a canary of X.Y.Z sorts below X.Y.Z itself. */
function rank(version: string): number[] {
  const { major, minor, patch, canary } = parseReleaseTag(`v${version}`);
  return [major, minor, patch, canary ?? Number.MAX_SAFE_INTEGER];
}

/** True when `version` (a release version, no `v`) is at or above `min`. */
export function meetsMinimum(version: string, min: string): boolean {
  const [x, y] = [rank(version), rank(min)];
  const i = x.findIndex((v, k) => v !== y[k]);
  return i === -1 || x[i] > y[i];
}
