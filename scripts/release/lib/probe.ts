import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
// The installed app's own manifest reader, so the probe reads a manifest exactly as an update does.
import { getFileList, parseUpdateInfo } from 'electron-updater/out/providers/Provider.js';
import { parseReleaseTag } from './release-plan.ts';

/**
 * The post-release probe (devstation-g98j, C3, F14): what a user's updater would fetch after a
 * release, checked against its tag. Each manifest must be served, must name the tag's version,
 * and every file it lists must be served with the sha512 it states. The receipt is what the
 * release gate's complete reads (`proofs/<bead>/checks/probe.json`, the release bead's).
 */

export interface ProbeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ProbeReceipt {
  tag: string;
  ok: boolean;
  base_url: string;
  checked_at: string;
  checks: ProbeCheck[];
}

/** The manifests a tag publishes: its channel (v<major>-stable or -canary) on every platform. */
export function readReleaseManifests(tag: string): string[] {
  const { major, canary } = parseReleaseTag(tag);
  const channel = `v${major}-${canary === null ? 'stable' : 'canary'}`;
  return [`${channel}.yml`, `${channel}-mac.yml`, `${channel}-linux.yml`];
}

async function readServedBytes(url: string): Promise<{ status: number; bytes: Buffer | null }> {
  const response = await fetch(url);
  if (!response.ok) return { status: response.status, bytes: null };
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
}

/**
 * The version a page the site served names, or why it names none. A site whose rewrite lags
 * answers 200 with its own HTML (the SPA fallback): that is a lagging site, not a crash.
 */
function servedVersion(bytes: Buffer, manifest: string): string {
  try {
    const { version } = parseUpdateInfo(bytes.toString('utf8'), manifest, pathToFileURL(manifest));
    if (typeof version === 'string' && version) return version;
    return 'a page that is not a manifest (it names no version)';
  } catch (error) {
    return `a page that is not a manifest (${(error as Error).message.split('\n')[0]})`;
  }
}

/**
 * The site's download dialog reads `<site>/releases/<manifest>` (devstation-mg6u.44, a rewrite to
 * the release bucket), so users see the release once that names the tag. The site may lag: it is
 * polled until it names the version or `waitMs` runs out (devstation-nfna, C8/F15).
 */
async function probeSite(
  site: { url: string; waitMs: number; intervalMs: number },
  manifest: string,
  version: string
): Promise<ProbeCheck> {
  const name = `site ${manifest} version`;
  const started = Date.now();
  let seen = 'nothing';
  for (;;) {
    const served = await readServedBytes(`${site.url}/releases/${manifest}`).catch(
      (error: Error) => ({
        status: error.message,
        bytes: null,
      })
    );
    if (served.bytes) {
      seen = servedVersion(served.bytes, manifest);
      if (seen === version) {
        const waited = Math.round((Date.now() - started) / 1000);
        return { name, ok: true, detail: `the site serves ${version} after ${waited} s` };
      }
    } else {
      seen = `answered ${served.status}`;
    }
    if (Date.now() - started >= site.waitMs) {
      const waited = Math.round(site.waitMs / 1000);
      return {
        name,
        ok: false,
        detail: `after ${waited} s the site still serves ${seen}; the tag is ${version}`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, site.intervalMs));
  }
}

export async function probeRelease(args: {
  tag: string;
  baseUrl: string;
  manifests: readonly string[];
  site?: { url: string; waitMs: number; intervalMs: number };
}): Promise<ProbeReceipt> {
  const version = args.tag.replace(/^v/, '');
  const checks: ProbeCheck[] = [];
  for (const manifest of args.manifests) {
    const served = await readServedBytes(`${args.baseUrl}/${manifest}`);
    if (!served.bytes) {
      checks.push({ name: `${manifest} fetch`, ok: false, detail: `answered ${served.status}` });
      continue;
    }
    const updateInfo = parseUpdateInfo(
      served.bytes.toString('utf8'),
      manifest,
      pathToFileURL(manifest)
    );
    checks.push({
      name: `${manifest} version`,
      ok: updateInfo.version === version,
      detail: `the manifest names ${updateInfo.version}; the tag is ${version}`,
    });
    const seen = new Set<string>();
    for (const file of getFileList(updateInfo)) {
      if (seen.has(file.url)) continue;
      seen.add(file.url);
      const download = await readServedBytes(`${args.baseUrl}/${file.url}`);
      if (!download.bytes) {
        checks.push({
          name: `sha512 ${file.url}`,
          ok: false,
          detail: `answered ${download.status}`,
        });
        continue;
      }
      const digest = createHash('sha512').update(download.bytes).digest('base64');
      checks.push({
        name: `sha512 ${file.url}`,
        ok: digest === file.sha512,
        detail: digest === file.sha512 ? 'matches the manifest' : 'differs from the manifest',
      });
    }
  }
  if (args.site && args.manifests.length > 0) {
    checks.push(await probeSite(args.site, args.manifests[0], version));
  }
  return {
    tag: args.tag,
    ok: checks.length > 0 && checks.every((check) => check.ok),
    base_url: args.baseUrl,
    checked_at: new Date().toISOString(),
    checks,
  };
}
