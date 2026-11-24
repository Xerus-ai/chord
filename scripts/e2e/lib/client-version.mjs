import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHORD_VERSION_HEADER, CHORD_VERSION_PARAM } from '@chord/protocol';

/**
 * The sync server refuses a signed-in request or socket that does not name a
 * supported app version (devstation-mg6u.13). The e2e fixtures that call the
 * server themselves, as a user of the app under test, name that app's version.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const APP_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;

/** Headers for a REST request to the sync server. */
export const versionHeaders = () => ({ [CHORD_VERSION_HEADER]: APP_VERSION });

/** A socket URL to the sync server, naming the app's version. */
export function withVersionParam(url) {
  const named = new URL(url);
  named.searchParams.set(CHORD_VERSION_PARAM, APP_VERSION);
  return named.toString();
}
