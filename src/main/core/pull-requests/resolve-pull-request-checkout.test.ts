import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { testDb } from '@main/core/work-items/test-support/work-items-test-db';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { resolvePullRequestCheckout } from './resolve-pull-request-checkout';

/**
 * What a pasted PR previews in the create dialog for the selected repository
 * (devstation-uoe). A PR is checked out from the remote that is its
 * repository; when no remote of the selected repository is, the lookup
 * refuses — the preview says so and Create stays disabled — instead of
 * previewing "Checks out <branch>" and failing only at Create. Every preview
 * that checks out names that remote (`baseRemote`); none picks one quietly.
 *
 * Real repositories, the REAL SQLite database, and a real Octokit pointed at a
 * loopback server standing in for api.github.com.
 */
vi.mock('@main/db/client', async () => ({
  db: (await import('@main/core/work-items/test-support/work-items-test-db')).testDrizzle,
}));

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

let server: Server;
let origin = '';
const seenPaths: string[] = [];

/** acme/api#7, opened from acme/api's own `retry-webhooks`. */
const sameRepositoryPull = {
  number: 7,
  title: 'Retry webhooks',
  html_url: 'https://github.com/acme/api/pull/7',
  maintainer_can_modify: false,
  head: {
    ref: 'retry-webhooks',
    user: { login: 'acme' },
    repo: {
      full_name: 'acme/api',
      clone_url: 'https://github.com/acme/api.git',
      owner: { login: 'acme' },
    },
  },
  base: { repo: { full_name: 'acme/api' } },
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://loopback');
    seenPaths.push(url.pathname);
    if (url.pathname !== '/repos/acme/api/pulls/7') {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(sameRepositoryPull));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

/**
 * A real, same-repository PR on github.com (the e2e pasted one of cli/cli's).
 * Real so that a lookup reaching GitHub anyway would find it and preview it.
 */
const otherRepositoryPull = { owner: 'cli', repo: 'cli', number: 14577, repoId: 'repo-1' };

const readOctokit = () => Promise.resolve(new Octokit({ baseUrl: origin, auth: 'ghp_test' }));

describe('previewing a pasted pull request against the selected repository', () => {
  let root: string;
  let repoDir: string;

  beforeEach(async () => {
    seenPaths.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-pr-checkout-'));
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    await git(['init'], repoDir);
    testDb
      .prepare('INSERT INTO repos (id, path, alias) VALUES (?, ?, ?)')
      .run('repo-1', repoDir, 'repo-1');
  });

  afterEach(() => {
    testDb.exec('DELETE FROM repos');
    removeDirSync(root);
  });

  it('checks a PR out from the remote that is its repository', async () => {
    await git(['remote', 'add', 'origin', 'https://github.com/acme/api.git'], repoDir);

    const result = await resolvePullRequestCheckout(
      { owner: 'acme', repo: 'api', number: 7, repoId: 'repo-1' },
      readOctokit
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.branch).toBe('retry-webhooks');
    expect(result.data.baseRemote).toBe('origin');
  });

  it("refuses a PR whose repository isn't a remote of the selected repository, without asking GitHub", async () => {
    await git(['remote', 'add', 'origin', 'https://github.com/acme/api.git'], repoDir);
    await git(['remote', 'add', 'mirror', path.join(root, 'mirror.git')], repoDir);

    const result = await resolvePullRequestCheckout(otherRepositoryPull, readOctokit);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('repository_not_a_remote');
    expect(result.error.message).toContain('cli/cli');
    expect(seenPaths).toEqual([]);
  });

  it('refuses it for a repository with no remote at all', async () => {
    const result = await resolvePullRequestCheckout(otherRepositoryPull, readOctokit);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('repository_not_a_remote');
    expect(seenPaths).toEqual([]);
  });

  it('refuses with no repository selected, which has no remote to check the PR out from', async () => {
    const result = await resolvePullRequestCheckout(
      { ...otherRepositoryPull, repoId: null },
      readOctokit
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('no_repo');
    expect(seenPaths).toEqual([]);
  });
});
