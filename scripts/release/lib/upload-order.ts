import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
// Not a public export: the parser electron-updater runs on a channel file inside the
// installed app. Reading manifests with it keeps this check exact; the tests import through
// it, so an upgrade that moves it fails them rather than the release.
import { getFileList, parseUpdateInfo } from 'electron-updater/out/providers/Provider.js';
import { info } from './log.ts';

/** The bucket, as much of it as publishing needs. The S3mini client satisfies it as is. */
export interface ReleaseStore {
  objectExists(key: string): Promise<boolean | null>;
  putObject(key: string, data: Uint8Array, contentType: string): Promise<unknown>;
}

export interface ReleaseFiles {
  installers: string[];
  blockmaps: string[];
  manifests: string[];
}

/**
 * The publish order (pipeline F10): installers and blockmaps first, the channel manifests
 * last. A manifest is what a running app's electron-updater reads, so writing it is the
 * commit point: before it, nothing points clients at the new files.
 */
export function uploadOrder(files: ReleaseFiles): string[] {
  return [...files.installers, ...files.blockmaps, ...files.manifests];
}

/**
 * The files a channel manifest sends clients to, read by electron-updater's own parser
 * (`files[].url`, else the legacy `path`), so the list is exactly what an updating app
 * downloads. R2 keys are bare file names: a URL or a path is refused.
 */
export function listManifestFiles(manifestName: string, text: string): string[] {
  const updateInfo = parseUpdateInfo(text, manifestName, pathToFileURL(manifestName));
  const names = [...new Set(getFileList(updateInfo).map((file) => file.url))];
  for (const name of names) {
    if (!/^[^/\\:]+$/.test(name)) {
      throw new Error(
        `${manifestName} lists '${name}', which is not a file name: R2 keys are file names`
      );
    }
  }
  return names;
}

async function assertListedFilesInStore(
  store: ReleaseStore,
  manifestKey: string,
  text: string
): Promise<void> {
  const missing: string[] = [];
  for (const listed of listManifestFiles(manifestKey, text)) {
    const exists = await store.objectExists(listed);
    if (exists === null) {
      throw new Error(
        `Could not check whether ${listed} (listed by ${manifestKey}) is in the bucket`
      );
    }
    if (!exists) missing.push(listed);
  }
  if (missing.length > 0) {
    throw new Error(
      `Refusing to publish ${manifestKey}: it lists files not in the bucket: ${missing.join(', ')}`
    );
  }
}

/**
 * Uploads a release in publish order. Before each manifest, every file it lists must already
 * be in the bucket; one written over missing files would break every update, so the run
 * throws instead and the manifest is never written.
 */
export async function publishRelease(store: ReleaseStore, files: ReleaseFiles): Promise<void> {
  const manifests = new Set(files.manifests);
  for (const file of uploadOrder(files)) {
    const key = basename(file);
    const isManifest = manifests.has(file);
    if (isManifest) await assertListedFilesInStore(store, key, readFileSync(file, 'utf8'));
    const data = readFileSync(file);
    info(`Uploading ${key} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
    await store.putObject(
      key,
      new Uint8Array(data),
      isManifest ? 'application/yaml' : 'application/octet-stream'
    );
    info(`Uploaded ${key}`);
  }
}
