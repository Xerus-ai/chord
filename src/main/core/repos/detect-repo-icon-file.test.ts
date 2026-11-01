import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_REPO_ICON_IMAGE_BYTES } from '@shared/repo-icons';
import { detectRepoIconFile, REPO_ICON_FILE_CANDIDATES } from './detect-repo-icon-file';

/**
 * Drives the real probe against a real temp directory holding real bytes.
 * Extension is not evidence: a `.png` written by a build script that emitted
 * HTML would produce a data URI the renderer draws as a broken image, so the
 * magic-byte gate is the thing under test here.
 */

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

/** RIFF container with the WEBP fourcc — the first 12 bytes are the format. */
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
  Buffer.alloc(14),
]);

let repoPath = '';

async function writeRepoFile(relativePath: string, contents: Buffer | string): Promise<void> {
  const target = join(repoPath, relativePath);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, contents);
}

let unreadablePaths: string[] = [];

/** Takes read access away from a repo file, so opening it fails with EACCES or EPERM. */
async function denyRead(relativePath: string): Promise<void> {
  const target = join(repoPath, relativePath);
  if (process.platform === 'win32') {
    execFileSync('icacls', [target, '/deny', `${userInfo().username}:(R)`]);
  } else {
    await chmod(target, 0o000);
  }
  unreadablePaths.push(target);
}

async function restoreRead(target: string): Promise<void> {
  if (process.platform === 'win32') {
    execFileSync('icacls', [target, '/remove:d', userInfo().username]);
  } else {
    await chmod(target, 0o755);
  }
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'chord-repo-icon-'));
  unreadablePaths = [];
});

afterEach(async () => {
  for (const target of unreadablePaths) await restoreRead(target);
  await rm(repoPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('repo icon file candidates', () => {
  it('probes conventional stems as .png and .webp, favicon before icon', () => {
    expect(REPO_ICON_FILE_CANDIDATES).toContain('favicon.png');
    expect(REPO_ICON_FILE_CANDIDATES).toContain('public/favicon.webp');
    expect(REPO_ICON_FILE_CANDIDATES).toContain('icon.png');
    expect(new Set(REPO_ICON_FILE_CANDIDATES).size).toBe(REPO_ICON_FILE_CANDIDATES.length);
    expect(REPO_ICON_FILE_CANDIDATES.indexOf('favicon.png')).toBeLessThan(
      REPO_ICON_FILE_CANDIDATES.indexOf('icon.png')
    );
  });
});

describe('detectRepoIconFile', () => {
  it('finds a real PNG and returns it as a png data URI', async () => {
    await writeRepoFile('favicon.png', PNG_BYTES);

    const outcome = await detectRepoIconFile(repoPath);

    expect(outcome).toEqual({
      kind: 'found',
      icon: {
        type: 'image',
        src: `data:image/png;base64,${PNG_BYTES.toString('base64')}`,
        source: 'file',
      },
    });
  });

  it('finds a real WebP and returns it as a webp data URI', async () => {
    await writeRepoFile('public/logo.webp', WEBP_BYTES);
    await writeRepoFile('logo.webp', WEBP_BYTES);

    const outcome = await detectRepoIconFile(repoPath);

    expect(outcome.kind).toBe('found');
    if (outcome.kind !== 'found' || outcome.icon.type !== 'image') throw new Error('not an image');
    expect(outcome.icon.src.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('rejects a file named .png whose bytes are not an image', async () => {
    await writeRepoFile('favicon.png', '<!doctype html><html></html>');

    expect(await detectRepoIconFile(repoPath)).toEqual({ kind: 'none' });
  });

  it('rejects a valid PNG that is past the byte cap', async () => {
    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_REPO_ICON_IMAGE_BYTES)]);
    await writeRepoFile('favicon.png', oversized);

    expect(await detectRepoIconFile(repoPath)).toEqual({ kind: 'none' });
  });

  it('accepts a valid PNG exactly at the byte cap', async () => {
    const atCap = Buffer.concat([
      PNG_BYTES,
      Buffer.alloc(MAX_REPO_ICON_IMAGE_BYTES - PNG_BYTES.length),
    ]);
    await writeRepoFile('favicon.png', atCap);

    expect((await detectRepoIconFile(repoPath)).kind).toBe('found');
  });

  it('prefers the earlier candidate when several exist', async () => {
    await writeRepoFile('logo.png', WEBP_BYTES);
    await writeRepoFile('favicon.png', PNG_BYTES);

    const outcome = await detectRepoIconFile(repoPath);

    if (outcome.kind !== 'found' || outcome.icon.type !== 'image') throw new Error('not an image');
    expect(outcome.icon.src.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('skips an oversized earlier candidate and takes the next valid one', async () => {
    await writeRepoFile('favicon.png', Buffer.alloc(MAX_REPO_ICON_IMAGE_BYTES + 1, 0x41));
    await writeRepoFile('logo.png', PNG_BYTES);

    expect((await detectRepoIconFile(repoPath)).kind).toBe('found');
  });

  it('ignores a directory that happens to be named like a candidate', async () => {
    await mkdir(join(repoPath, 'favicon.png'), { recursive: true });

    expect(await detectRepoIconFile(repoPath)).toEqual({ kind: 'none' });
  });

  it('reports nothing for a repo with no icon files at all', async () => {
    await writeRepoFile('README.md', '# nothing to see');

    expect(await detectRepoIconFile(repoPath)).toEqual({ kind: 'none' });
  });

  it('follows an icon href declared in index.html', async () => {
    await writeRepoFile('index.html', '<html><head><link rel="icon" href="/brand.png" /></head>');
    await writeRepoFile('public/brand.png', PNG_BYTES);

    const outcome = await detectRepoIconFile(repoPath);

    if (outcome.kind !== 'found' || outcome.icon.type !== 'image') throw new Error('not an image');
    expect(outcome.icon.src).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
  });

  it('follows an icon href declared next to a nested root route file', async () => {
    await writeRepoFile(
      'src/routes/__root.tsx',
      `const links = [{ rel: 'icon', href: 'mark.png' }]`
    );
    await writeRepoFile('src/routes/mark.png', PNG_BYTES);

    expect((await detectRepoIconFile(repoPath)).kind).toBe('found');
  });

  it('refuses a declared href that escapes the repository', async () => {
    await writeRepoFile('index.html', '<link rel="icon" href="../../outside.png">');

    expect(await detectRepoIconFile(repoPath)).toEqual({ kind: 'none' });
  });

  it('refuses a declared href that is an absolute remote URL', async () => {
    await writeRepoFile('index.html', '<link rel="icon" href="https://cdn.example.com/f.png">');

    expect(await detectRepoIconFile(repoPath)).toEqual({ kind: 'none' });
  });

  it('fails rather than reporting nothing when the repo path is not a readable directory', async () => {
    const outcome = await detectRepoIconFile(join(repoPath, 'does-not-exist'));

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failure');
    expect(outcome.error).toMatch(/does-not-exist/);
  });

  it('fails when the repo path is a file rather than a directory', async () => {
    await writeRepoFile('not-a-repo', 'x');

    expect((await detectRepoIconFile(join(repoPath, 'not-a-repo'))).kind).toBe('failed');
  });
});

// Characterized black-box on the pre-rewrite build (devstation-7orh): a path whose stat fails is
// skipped like a missing one; a path that stats as a regular file within the cap but cannot then
// be read ends the scan as `failed`, even when a later path holds a usable icon.
describe('detectRepoIconFile on a path it cannot stat', () => {
  it('skips a declared href holding a NUL character and goes on to the next declaring file', async () => {
    await writeRepoFile('index.html', '<link rel="icon" href="/a\u0000b.png">');
    await writeRepoFile('src/index.html', '<link rel="icon" href="/brand.png">');
    await writeRepoFile('brand.png', PNG_BYTES);

    expect((await detectRepoIconFile(repoPath)).kind).toBe('found');
  });

  it('skips a declared href whose path segment is too long for the file system', async () => {
    await writeRepoFile('index.html', `<link rel="icon" href="/${'a'.repeat(300)}.png">`);
    await writeRepoFile('src/index.html', '<link rel="icon" href="/brand.png">');
    await writeRepoFile('brand.png', PNG_BYTES);

    expect((await detectRepoIconFile(repoPath)).kind).toBe('found');
  });

  describe.runIf(process.platform !== 'win32')('POSIX', () => {
    it('skips a candidate inside a directory it cannot search', async () => {
      await writeRepoFile('public/favicon.png', PNG_BYTES);
      await chmod(join(repoPath, 'public'), 0o000);
      unreadablePaths.push(join(repoPath, 'public'));
      await writeRepoFile('logo.png', PNG_BYTES);

      expect((await detectRepoIconFile(repoPath)).kind).toBe('found');
    });

    it('skips a candidate that is a symbolic link loop', async () => {
      await symlink('favicon.webp', join(repoPath, 'favicon.png'));
      await symlink('favicon.png', join(repoPath, 'favicon.webp'));
      await writeRepoFile('logo.png', PNG_BYTES);

      expect((await detectRepoIconFile(repoPath)).kind).toBe('found');
    });
  });
});

describe('detectRepoIconFile on a path it cannot read', () => {
  function expectUnreadable(outcome: Awaited<ReturnType<typeof detectRepoIconFile>>, file: string) {
    if (outcome.kind !== 'failed') throw new Error(`expected failed, got ${outcome.kind}`);
    expect(outcome.error).toMatch(/^Cannot read a repo icon candidate: Error: E(ACCES|PERM)\b/);
    expect(outcome.error).toContain(join(repoPath, file));
  }

  it('fails on an unreadable candidate and does not go on to a later usable one', async () => {
    await writeRepoFile('public/favicon.png', PNG_BYTES);
    await denyRead('public/favicon.png');
    await writeRepoFile('logo.png', PNG_BYTES);

    expectUnreadable(await detectRepoIconFile(repoPath), 'public/favicon.png');
  });

  it('fails on an unreadable icon-declaring file', async () => {
    await writeRepoFile('index.html', '<link rel="icon" href="/brand.png">');
    await denyRead('index.html');
    await writeRepoFile('src/root.tsx', `const links = [{ rel: 'icon', href: 'mark.png' }]`);
    await writeRepoFile('src/mark.png', PNG_BYTES);

    expectUnreadable(await detectRepoIconFile(repoPath), 'index.html');
  });

  it('fails on an unreadable file a declared href points at', async () => {
    await writeRepoFile('index.html', '<link rel="icon" href="/brand.png">');
    await writeRepoFile('brand.png', PNG_BYTES);
    await denyRead('brand.png');

    expectUnreadable(await detectRepoIconFile(repoPath), 'brand.png');
  });
});
