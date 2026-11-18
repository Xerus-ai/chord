import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyReleaseDir } from './release-dir.ts';

/**
 * The build job's artifact check (devstation-pqub, F25): before a platform's release/ folder
 * leaves its runner, each channel manifest must name the tag's version and list only files that
 * are in the folder with the sha512 it states, exactly as an updating app will check them.
 */
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha512 = (text: string) => createHash('sha512').update(text).digest('base64');

/** The manifest electron-builder writes for one installer. */
function manifest(version: string, file: string, digest: string): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${digest}`,
    '    size: 12',
    `path: ${file}`,
    `sha512: ${digest}`,
    "releaseDate: '2026-11-18T00:00:00.000Z'",
    '',
  ].join('\n');
}

function createReleaseDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-dir-'));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const INSTALLER = 'installer bytes';

describe('verifyReleaseDir', () => {
  it('accepts a folder whose manifest names the tag and whose installer matches its sha512', () => {
    const dir = createReleaseDir({
      'chord-x64.exe': INSTALLER,
      'v1-stable.yml': manifest('1.1.0', 'chord-x64.exe', sha512(INSTALLER)),
    });

    expect(verifyReleaseDir(dir, 'v1.1.0')).toEqual(['v1-stable.yml']);
  });

  it('refuses an installer that differs from the sha512 its manifest states', () => {
    const dir = createReleaseDir({
      'chord-x64.exe': 'other bytes',
      'v1-stable.yml': manifest('1.1.0', 'chord-x64.exe', sha512(INSTALLER)),
    });

    expect(() => verifyReleaseDir(dir, 'v1.1.0')).toThrow(/chord-x64\.exe.*sha512/);
  });

  it('refuses a manifest whose version is not the tag', () => {
    const dir = createReleaseDir({
      'chord-x64.exe': INSTALLER,
      'v1-stable.yml': manifest('1.0.9', 'chord-x64.exe', sha512(INSTALLER)),
    });

    expect(() => verifyReleaseDir(dir, 'v1.1.0')).toThrow(/v1-stable\.yml names 1\.0\.9/);
  });

  it('refuses a manifest that lists a file the folder does not have', () => {
    const dir = createReleaseDir({
      'v1-stable-linux.yml': manifest('1.1.0', 'chord-x86_64.AppImage', sha512(INSTALLER)),
    });

    expect(() => verifyReleaseDir(dir, 'v1.1.0')).toThrow(/chord-x86_64\.AppImage.*not in/);
  });

  it("refuses a manifest of the other channel (a stable build's manifest for a canary tag)", () => {
    const dir = createReleaseDir({
      'chord-x64.exe': INSTALLER,
      'v1-stable.yml': manifest('1.1.0-canary.1', 'chord-x64.exe', sha512(INSTALLER)),
    });

    expect(() => verifyReleaseDir(dir, 'v1.1.0-canary.1')).toThrow(/v1-stable\.yml/);
  });

  it('refuses a folder with no manifest at all', () => {
    const dir = createReleaseDir({ 'chord-x64.exe': INSTALLER });

    expect(() => verifyReleaseDir(dir, 'v1.1.0')).toThrow(/no update manifest/);
  });
});
