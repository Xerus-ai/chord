import { pathToFileURL } from 'node:url';
// The installed app's own manifest reader, as probe.ts uses it.
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider.js';
import { meetsMinimum } from './min-desktop.ts';
import { probeRelease, readReleaseManifests, type ProbeCheck } from './probe.ts';

/**
 * Whether every update channel serves a desktop release that meets a new MIN_DESKTOP_VERSION
 * (server/DEPLOYMENT.md section 7, steps 1 and 2): each channel's Windows manifest names a
 * version at or above it, and the probe of that version passes on all three platforms.
 */
export async function checkChannelsMeetMinimum(args: {
  baseUrl: string;
  major: number;
  min: string;
}): Promise<{ ok: boolean; checks: ProbeCheck[] }> {
  const checks: ProbeCheck[] = [];
  for (const channel of ['stable', 'canary']) {
    const manifest = `v${args.major}-${channel}.yml`;
    const response = await fetch(`${args.baseUrl}/${manifest}`);
    if (!response.ok) {
      checks.push({ name: `${manifest} fetch`, ok: false, detail: `answered ${response.status}` });
      continue;
    }
    const { version } = parseUpdateInfo(await response.text(), manifest, pathToFileURL(manifest));
    const meets = meetsMinimum(version, args.min);
    checks.push({
      name: `${manifest} meets ${args.min}`,
      ok: meets,
      detail: `the ${channel} channel serves ${version}`,
    });
    if (!meets) continue;
    const tag = `v${version}`;
    const receipt = await probeRelease({
      tag,
      baseUrl: args.baseUrl,
      manifests: readReleaseManifests(tag),
    });
    checks.push(...receipt.checks);
  }
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks };
}
