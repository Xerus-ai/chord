import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
// The installed app's own manifest reader, so the check reads a manifest exactly as an update does.
import { getFileList, parseUpdateInfo } from 'electron-updater/out/providers/Provider.js';
import { readReleaseManifests } from './probe.ts';

/**
 * The build job's artifact check (devstation-pqub, F25), before a platform's release/ folder
 * is uploaded: every channel manifest in it belongs to the tag's channel, names the tag's
 * version, and lists only files in the folder whose sha512 matches. Returns the manifests
 * checked; throws naming the first problem.
 */
export function verifyReleaseDir(dir: string, tag: string): string[] {
  const version = tag.replace(/^v/, '');
  const expected = new Set(readReleaseManifests(tag));
  const manifests = readdirSync(dir).filter((name) =>
    /^v\d+-(stable|canary)(-mac|-linux)?\.yml$/.test(name)
  );
  if (manifests.length === 0) throw new Error(`${dir} has no update manifest`);
  for (const name of manifests) {
    if (!expected.has(name)) {
      throw new Error(`${name} is not a manifest of ${tag} (${[...expected].join(', ')})`);
    }
    const info = parseUpdateInfo(readFileSync(join(dir, name), 'utf8'), name, pathToFileURL(name));
    if (info.version !== version) {
      throw new Error(`${name} names ${info.version}; the tag is ${tag}`);
    }
    for (const file of getFileList(info)) {
      const path = join(dir, file.url);
      if (!existsSync(path)) throw new Error(`${name} lists ${file.url}, which is not in ${dir}`);
      const digest = createHash('sha512').update(readFileSync(path)).digest('base64');
      if (digest !== file.sha512) {
        throw new Error(`${file.url} differs from the sha512 ${name} states`);
      }
    }
  }
  return manifests;
}
