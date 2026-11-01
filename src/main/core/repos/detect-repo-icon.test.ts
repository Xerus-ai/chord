import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { detectRepoIcon } from './detect-repo-icon';

const execFileAsync = promisify(execFile);

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * The whole point of this suite is the persist decision. `none` writes
 * `{type:'letter'}` and stops probing forever, so a transient network failure
 * that mapped to `none` would permanently mark a repo as iconless. Every
 * boundary between the two is therefore driven through real git remotes and a
 * real HTTP server rather than asserted about the source.
 */
let server: Server;
let avatarOrigin = '';
let repoPath = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (pathname === '/avatar-owner.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(PNG_BYTES);
      return;
    }
    if (pathname === '/broken-owner.png') {
      response.writeHead(500).end('Internal Server Error');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  avatarOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'chord-detect-icon-'));
  await execFileAsync('git', ['init'], { cwd: repoPath });
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function setOrigin(url: string): Promise<void> {
  await execFileAsync('git', ['remote', 'add', 'origin', url], { cwd: repoPath });
}

async function writeRepoFile(relativePath: string, contents: Buffer | string): Promise<void> {
  const target = join(repoPath, relativePath);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, contents);
}

describe('detectRepoIcon', () => {
  it('takes a repository icon file ahead of the owner avatar', async () => {
    await setOrigin('https://github.com/avatar-owner/thing.git');
    await writeRepoFile('favicon.png', PNG_BYTES);

    const outcome = await detectRepoIcon({ repoPath, avatarOrigin });

    if (outcome.kind !== 'found' || outcome.icon.type !== 'image') throw new Error('not an image');
    expect(outcome.icon.source).toBe('file');
  });

  it("falls through to the origin owner's avatar when the repo has no icon file", async () => {
    await setOrigin('https://github.com/avatar-owner/thing.git');

    const outcome = await detectRepoIcon({ repoPath, avatarOrigin });

    if (outcome.kind !== 'found' || outcome.icon.type !== 'image') throw new Error('not an image');
    expect(outcome.icon.source).toBe('github');
    expect(outcome.icon.src).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
  });

  it('reads the owner out of an scp-style ssh remote too', async () => {
    await setOrigin('git@github.com:avatar-owner/thing.git');

    expect((await detectRepoIcon({ repoPath, avatarOrigin })).kind).toBe('found');
  });

  it('settles on the letter tile when there is no origin remote to ask about', async () => {
    expect(await detectRepoIcon({ repoPath, avatarOrigin })).toEqual({ kind: 'none' });
  });

  it('settles on the letter tile for a remote that is not GitHub', async () => {
    await setOrigin('https://gitlab.com/gitlab-org/gitlab.git');

    expect(await detectRepoIcon({ repoPath, avatarOrigin })).toEqual({ kind: 'none' });
  });

  it('settles on the letter tile when the avatar endpoint answers 404', async () => {
    await setOrigin('https://github.com/no-such-owner/thing.git');

    expect(await detectRepoIcon({ repoPath, avatarOrigin })).toEqual({ kind: 'none' });
  });

  it('fails — persisting nothing — when the avatar endpoint answers 500', async () => {
    await setOrigin('https://github.com/broken-owner/thing.git');

    const outcome = await detectRepoIcon({ repoPath, avatarOrigin });

    expect(outcome.kind).toBe('failed');
  });

  it('fails when the avatar host cannot be reached at all', async () => {
    await setOrigin('https://github.com/avatar-owner/thing.git');

    const outcome = await detectRepoIcon({
      repoPath,
      avatarOrigin: 'http://127.0.0.1:1',
      timeoutMs: 1000,
    });

    expect(outcome.kind).toBe('failed');
  });

  it('fails when the request never answers', async () => {
    await setOrigin('https://github.com/avatar-owner/thing.git');
    const hanging = createServer(() => {});
    await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', resolve));

    try {
      const outcome = await detectRepoIcon({
        repoPath,
        avatarOrigin: `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`,
        timeoutMs: 150,
      });

      expect(outcome.kind).toBe('failed');
    } finally {
      hanging.closeAllConnections();
      await new Promise<void>((resolve) => hanging.close(() => resolve()));
    }
  });

  it('fails without probing GitHub when the repo directory is unreadable', async () => {
    const outcome = await detectRepoIcon({ repoPath: join(repoPath, 'gone'), avatarOrigin });

    expect(outcome.kind).toBe('failed');
  });
});
