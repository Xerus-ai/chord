import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
// The installed app's own manifest reader, so the probe reads a manifest exactly as an update does.
import { getFileList, parseUpdateInfo } from 'electron-updater/out/providers/Provider.js';
import { parseReleaseTag } from './release-plan.ts';

/**
 * The post-release probe (devstation-g98j, C3, F14): what a user's updater would fetch after a
 * release, checked against its tag. Each manifest must be served, must name the tag's version,
 * and every file it lists must be served with the sha512 it states. The receipt is what the
 * release gate's complete reads (`proofs/release-<tag>/probe.json`).
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

export async function probeRelease(args: {
  tag: string;
  baseUrl: string;
  manifests: readonly string[];
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
  return {
    tag: args.tag,
    ok: checks.length > 0 && checks.every((check) => check.ok),
    base_url: args.baseUrl,
    checked_at: new Date().toISOString(),
    checks,
  };
}
