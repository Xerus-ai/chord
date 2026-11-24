import { CHORD_VERSION_PARAM } from '@chord/protocol';
import packageJson from '@root/package.json';

/**
 * This build's version, as electron-builder stamps it on the installer: the one
 * the app names to the sync server on every request (devstation-mg6u.13), from
 * main and renderer alike, so the two can never disagree.
 */
export const APP_VERSION: string = packageJson.version;

/** A sync-server socket URL naming this build's version (a browser WebSocket cannot set headers). */
export function withAppVersion(url: string): string {
  const named = new URL(url);
  named.searchParams.set(CHORD_VERSION_PARAM, APP_VERSION);
  return named.toString();
}
