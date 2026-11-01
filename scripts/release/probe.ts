import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { R2_BASE_URL } from './lib/config.ts';
import { fail, info } from './lib/log.ts';
import { probeRelease, readReleaseManifests } from './lib/probe.ts';

/**
 * Probes a published release (devstation-g98j, C3, F14) and writes the receipt the release gate
 * completes on. The manifests are the tag's channel on every platform: v<major>-stable or
 * v<major>-canary, plus -mac and -linux. Exit 0 when every check passes.
 *
 *   node scripts/release/probe.ts --tag vX.Y.Z --out <harness>/.command-center/proofs/release-vX.Y.Z/probe.json [--base <url>]
 */
const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    out: { type: 'string' },
    base: { type: 'string', default: R2_BASE_URL },
  },
  strict: true,
});
if (!values.tag || !values.out)
  fail('Usage: probe.ts --tag vX.Y.Z --out <probe.json> [--base <url>]');

const receipt = await probeRelease({
  tag: values.tag,
  baseUrl: values.base.replace(/\/+$/, ''),
  manifests: readReleaseManifests(values.tag),
});
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, `${JSON.stringify(receipt, null, 2)}\n`);
for (const check of receipt.checks)
  info(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
if (!receipt.ok) fail(`the probe of ${values.tag} failed; receipt at ${values.out}`);
info(`the probe of ${values.tag} passed; receipt at ${values.out}`);
