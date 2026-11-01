import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_REPO_ICON_IMAGE_BYTES } from '@shared/repo-icons';
import { buildGitHubAvatarUrl, fetchGitHubAvatarIcon } from './detect-repo-icon-github';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

/** SOI + APP0/JFIF — avatars come back as JPEG at least as often as PNG. */
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'ascii'),
  Buffer.alloc(10),
  Buffer.from([0xff, 0xd9]),
]);

const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
  Buffer.alloc(14),
]);

/**
 * A REAL HTTP server on loopback, not a mocked fetch: the thing worth proving is
 * that a 404 and a 500 land on opposite sides of the persist decision, and a
 * stubbed `fetch` would only prove that the stub was called.
 */
let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    switch (request.url) {
      case '/png-owner.png':
        response.writeHead(200, { 'content-type': 'image/png' }).end(PNG_BYTES);
        return;
      case '/jpeg-owner.png':
        response.writeHead(200, { 'content-type': 'image/jpeg' }).end(JPEG_BYTES);
        return;
      case '/webp-owner.png':
        response.writeHead(200, { 'content-type': 'image/webp' }).end(WEBP_BYTES);
        return;
      case '/lying-content-type.png':
        // Content-Type is the server's claim; the bytes are the evidence.
        response.writeHead(200, { 'content-type': 'image/png' }).end('<html>nope</html>');
        return;
      case '/huge-owner.png':
        response
          .writeHead(200, { 'content-type': 'image/png' })
          .end(Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_REPO_ICON_IMAGE_BYTES + 1)]));
        return;
      case '/missing-owner.png':
        response.writeHead(404).end('Not Found');
        return;
      case '/broken-owner.png':
        response.writeHead(500).end('Internal Server Error');
        return;
      case '/rate-limited-owner.png':
        response.writeHead(403).end('rate limit exceeded');
        return;
      case '/hanging-owner.png':
        // Deliberately never answers, so the timeout path is the real one.
        return;
      default:
        response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

describe('buildGitHubAvatarUrl', () => {
  it('uses the owner, not the repository, and caps the size', () => {
    const url = buildGitHubAvatarUrl({ host: 'github.com', slug: 'vercel/next.js' });

    expect(url).toBe('https://github.com/vercel.png?size=64');
  });

  it('keeps a GitHub Enterprise host the remote parsing already yielded', () => {
    expect(buildGitHubAvatarUrl({ host: 'github.acme.corp', slug: 'platform/api' })).toBe(
      'https://github.acme.corp/platform.png?size=64'
    );
  });

  it('refuses a host that is not GitHub', () => {
    expect(buildGitHubAvatarUrl({ host: 'gitlab.com', slug: 'gitlab-org/gitlab' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'bitbucket.org', slug: 'atlassian/x' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'notgithub.com', slug: 'a/b' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'github.com.evil.example', slug: 'a/b' })).toBeNull();
  });

  it('refuses a slug that is not owner/repo', () => {
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: 'torvalds' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: 'group/sub/repo' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: '/linux' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: '' })).toBeNull();
  });

  it('refuses an owner that is not a plausible login, so the path cannot be steered', () => {
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: 'a b/repo' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: '..%2Fevil/repo' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: '../repo' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: 'owner?x=1/repo' })).toBeNull();
    expect(buildGitHubAvatarUrl({ host: 'github.com', slug: 'org-name/repo' })).toBe(
      'https://github.com/org-name.png?size=64'
    );
  });
});

describe('fetchGitHubAvatarIcon', () => {
  it('returns a github-sourced icon for a PNG avatar', async () => {
    const outcome = await fetchGitHubAvatarIcon(`${origin}/png-owner.png`);

    expect(outcome).toEqual({
      kind: 'found',
      icon: {
        type: 'image',
        src: `data:image/png;base64,${PNG_BYTES.toString('base64')}`,
        source: 'github',
      },
    });
  });

  it('accepts a JPEG avatar', async () => {
    const outcome = await fetchGitHubAvatarIcon(`${origin}/jpeg-owner.png`);

    if (outcome.kind !== 'found' || outcome.icon.type !== 'image') throw new Error('not an image');
    expect(outcome.icon.src.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('accepts a WebP avatar', async () => {
    const outcome = await fetchGitHubAvatarIcon(`${origin}/webp-owner.png`);

    if (outcome.kind !== 'found' || outcome.icon.type !== 'image') throw new Error('not an image');
    expect(outcome.icon.src.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('reports nothing for a 404 — that owner has no avatar to fetch', async () => {
    expect(await fetchGitHubAvatarIcon(`${origin}/missing-owner.png`)).toEqual({ kind: 'none' });
  });

  it('reports nothing when the body is not an image whatever the Content-Type claims', async () => {
    expect(await fetchGitHubAvatarIcon(`${origin}/lying-content-type.png`)).toEqual({
      kind: 'none',
    });
  });

  it('reports nothing for an avatar past the byte cap', async () => {
    expect(await fetchGitHubAvatarIcon(`${origin}/huge-owner.png`)).toEqual({ kind: 'none' });
  });

  it('fails on a 500 so the column stays NULL and the probe is retried', async () => {
    const outcome = await fetchGitHubAvatarIcon(`${origin}/broken-owner.png`);

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failure');
    expect(outcome.error).toMatch(/500/);
  });

  it('fails on a 403, which is what a rate limit looks like', async () => {
    expect((await fetchGitHubAvatarIcon(`${origin}/rate-limited-owner.png`)).kind).toBe('failed');
  });

  it('fails on a request that never answers', async () => {
    const outcome = await fetchGitHubAvatarIcon(`${origin}/hanging-owner.png`, { timeoutMs: 150 });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failure');
    expect(outcome.error).toMatch(/timed out|abort/i);
  });

  it('fails on a network error rather than claiming the repo has no icon', async () => {
    const closedPort = `http://127.0.0.1:1/owner.png`;

    expect((await fetchGitHubAvatarIcon(closedPort, { timeoutMs: 1000 })).kind).toBe('failed');
  });
});
