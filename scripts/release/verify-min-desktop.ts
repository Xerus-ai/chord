import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkChannelsMeetMinimum } from './lib/channel-minimum.ts';
import { R2_BASE_URL } from './lib/config.ts';
import { fail, info } from './lib/log.ts';
import { readMinDesktopVersion } from './lib/min-desktop.ts';
import { parseReleaseTag } from './lib/release-plan.ts';

/**
 * Before a server release that raises MIN_DESKTOP_VERSION deploys (server/DEPLOYMENT.md
 * section 7; devstation-mg6u.24): every update channel must serve a desktop release that meets
 * the minimum this checkout declares, and that release's probe must pass. Exit 0 when it does.
 *
 *   node --experimental-strip-types scripts/release/verify-min-desktop.ts --tag vX.Y.Z [--base <url>]
 */
const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    base: { type: 'string', default: R2_BASE_URL },
  },
  strict: true,
});
if (!values.tag) fail('Usage: verify-min-desktop.ts --tag vX.Y.Z [--base <url>]');

const min = readMinDesktopVersion(readFileSync('packages/protocol/src/version.ts', 'utf8'));
const result = await checkChannelsMeetMinimum({
  baseUrl: values.base.replace(/\/+$/, ''),
  major: parseReleaseTag(values.tag).major,
  min,
});
for (const check of result.checks)
  info(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
if (!result.ok) {
  fail(
    `not every channel serves a release that meets MIN_DESKTOP_VERSION ${min}; the server ` +
      'keeps the old minimum. Publish one on each channel, then rerun this job.'
  );
}
info(`every channel serves a release that meets ${min}`);
