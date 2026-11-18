import { parseArgs } from 'node:util';
import { RELEASE_DIR } from './lib/config.ts';
import { fail, info } from './lib/log.ts';
import { verifyReleaseDir } from './lib/release-dir.ts';

/**
 * The build job's artifact check (devstation-pqub, F25): each channel manifest in release/
 * names the tag's version and lists only files in release/ with the sha512 it states.
 *
 *   node --experimental-strip-types scripts/release/verify-release-dir.ts --tag vX.Y.Z [--dir release]
 */
const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    dir: { type: 'string', default: RELEASE_DIR },
  },
  strict: true,
});
if (!values.tag) fail('Usage: verify-release-dir.ts --tag vX.Y.Z [--dir release]');

try {
  const manifests = verifyReleaseDir(values.dir, values.tag);
  info(`${values.dir} holds ${values.tag}: ${manifests.join(', ')} match their files`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
