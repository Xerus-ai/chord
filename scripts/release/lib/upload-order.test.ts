import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listManifestFiles,
  publishRelease,
  uploadOrder,
  type ReleaseStore,
} from './upload-order.ts';

/** A bucket on disk: a key is in it when its file is. */
function createDirectoryStore(dir: string): ReleaseStore {
  mkdirSync(dir, { recursive: true });
  return {
    objectExists: async (key) => existsSync(join(dir, key)),
    putObject: async (key, data) => writeFileSync(join(dir, key), data),
  };
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A release/ folder holding the named files, the manifest with WIN_MANIFEST's text. */
function createReleaseDir(names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  temps.push(dir);
  for (const name of names) {
    writeFileSync(join(dir, name), name.endsWith('.yml') ? WIN_MANIFEST : `bytes of ${name}`);
  }
  return dir;
}

// The shapes electron-builder writes: a Windows channel file and a macOS one whose zip (the
// update payload) is also its legacy `path`.
const WIN_MANIFEST = `version: 1.4.0
files:
  - url: chord-1.4.0-x64.exe
    sha512: c2hhNTEyLXdpbg==
    size: 104857600
path: chord-1.4.0-x64.exe
sha512: c2hhNTEyLXdpbg==
releaseDate: '2026-10-18T00:00:00.000Z'
`;

const MAC_MANIFEST = `version: 1.4.0
files:
  - url: chord-1.4.0-arm64.zip
    sha512: c2hhNTEyLXppcA==
    size: 98566144
  - url: chord-1.4.0-arm64.dmg
    sha512: c2hhNTEyLWRtZw==
    size: 101711872
path: chord-1.4.0-arm64.zip
sha512: c2hhNTEyLXppcA==
releaseDate: '2026-10-18T00:00:00.000Z'
`;

describe('uploadOrder', () => {
  it('puts installers and blockmaps before every manifest', () => {
    const order = uploadOrder({
      manifests: ['release/v1-stable.yml', 'release/v1-stable-mac.yml'],
      installers: ['release/chord-1.4.0-x64.exe', 'release/chord-1.4.0-arm64.zip'],
      blockmaps: ['release/chord-1.4.0-x64.exe.blockmap'],
    });
    expect(order).toEqual([
      'release/chord-1.4.0-x64.exe',
      'release/chord-1.4.0-arm64.zip',
      'release/chord-1.4.0-x64.exe.blockmap',
      'release/v1-stable.yml',
      'release/v1-stable-mac.yml',
    ]);
  });
});

describe('listManifestFiles', () => {
  it('reads files[].url as electron-updater does', () => {
    expect(listManifestFiles('v1-stable.yml', WIN_MANIFEST)).toEqual(['chord-1.4.0-x64.exe']);
    expect(listManifestFiles('v1-stable-mac.yml', MAC_MANIFEST)).toEqual([
      'chord-1.4.0-arm64.zip',
      'chord-1.4.0-arm64.dmg',
    ]);
  });

  it('reads the legacy path when there is no files list', () => {
    const legacy = 'version: 1.0.0\npath: chord-1.0.0-x64.exe\nsha512: c2hh\n';
    expect(listManifestFiles('v1-stable.yml', legacy)).toEqual(['chord-1.0.0-x64.exe']);
  });

  it('lists a file named twice once', () => {
    const twice = MAC_MANIFEST.replace('chord-1.4.0-arm64.dmg', 'chord-1.4.0-arm64.zip');
    expect(listManifestFiles('v1-stable-mac.yml', twice)).toEqual(['chord-1.4.0-arm64.zip']);
  });

  it('refuses a URL or a path, since R2 keys are file names', () => {
    const url = WIN_MANIFEST.replace(
      'url: chord-1.4.0-x64.exe',
      'url: https://cdn.example/chord-1.4.0-x64.exe'
    );
    expect(() => listManifestFiles('v1-stable.yml', url)).toThrow(
      /v1-stable\.yml.*not a file name/
    );
    const nested = WIN_MANIFEST.replace('url: chord-1.4.0-x64.exe', 'url: win/chord-1.4.0-x64.exe');
    expect(() => listManifestFiles('v1-stable.yml', nested)).toThrow(/not a file name/);
  });

  it('refuses a manifest that lists no files or does not parse', () => {
    expect(() => listManifestFiles('v1-stable.yml', 'version: 1.4.0\n')).toThrow(
      /No files provided/
    );
    expect(() => listManifestFiles('v1-stable.yml', 'files: [\n')).toThrow(
      /Cannot parse update info/
    );
  });
});

describe('publishRelease', () => {
  it('uploads the installer and blockmap, then the manifest that lists them', async () => {
    const release = createReleaseDir([
      'chord-1.4.0-x64.exe',
      'chord-1.4.0-x64.exe.blockmap',
      'v1-stable.yml',
    ]);
    const bucket = join(release, 'bucket');
    await publishRelease(createDirectoryStore(bucket), {
      installers: [join(release, 'chord-1.4.0-x64.exe')],
      blockmaps: [join(release, 'chord-1.4.0-x64.exe.blockmap')],
      manifests: [join(release, 'v1-stable.yml')],
    });
    expect(readdirSync(bucket).sort()).toEqual([
      'chord-1.4.0-x64.exe',
      'chord-1.4.0-x64.exe.blockmap',
      'v1-stable.yml',
    ]);
  });

  it('refuses a manifest whose installer is not in the bucket, before writing it', async () => {
    const release = createReleaseDir(['chord-1.4.0-x64.exe.blockmap', 'v1-stable.yml']);
    const bucket = join(release, 'bucket');
    await expect(
      publishRelease(createDirectoryStore(bucket), {
        installers: [],
        blockmaps: [join(release, 'chord-1.4.0-x64.exe.blockmap')],
        manifests: [join(release, 'v1-stable.yml')],
      })
    ).rejects.toThrow(/Refusing to publish v1-stable\.yml.*chord-1\.4\.0-x64\.exe/);
    expect(readdirSync(bucket)).toEqual(['chord-1.4.0-x64.exe.blockmap']);
  });

  it('refuses a manifest when the bucket cannot answer whether a file is there', async () => {
    const release = createReleaseDir(['chord-1.4.0-x64.exe', 'v1-stable.yml']);
    const bucket = join(release, 'bucket');
    const store = createDirectoryStore(bucket);
    const unanswered: ReleaseStore = { ...store, objectExists: async () => null };
    await expect(
      publishRelease(unanswered, {
        installers: [join(release, 'chord-1.4.0-x64.exe')],
        blockmaps: [],
        manifests: [join(release, 'v1-stable.yml')],
      })
    ).rejects.toThrow(/Could not check whether chord-1\.4\.0-x64\.exe.*v1-stable\.yml/);
    expect(readdirSync(bucket)).toEqual(['chord-1.4.0-x64.exe']);
  });
});
