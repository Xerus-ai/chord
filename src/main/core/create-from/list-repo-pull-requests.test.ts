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
import { listRepoPullRequests } from './list-repo-pull-requests';
import { readRepoGitHubRepository } from './repo-github-repository';

/**
 * Which GitHub repository a registered repository's PRs and issues are read
 * from in Create from… (plan §Phase 3 slice 2): the GitHub remote of its
 * checkout — `origin` first, then any other — read from the repository's own
 * git config. A repository with no GitHub remote has no PRs to pick, and the
 * PRs tab says so instead of listing nothing.
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

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://loopback');
    seenPaths.push(url.pathname);
    if (url.pathname !== '/repos/acme/api/pulls') {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify([
        {
          number: 12,
          title: 'Retry webhooks',
          html_url: 'https://github.com/acme/api/pull/12',
          draft: false,
          user: { login: 'alice' },
        },
      ])
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

const readOctokit = () => Promise.resolve(new Octokit({ baseUrl: origin, auth: 'ghp_test' }));

describe('a repository’s GitHub repository and pull requests', () => {
  let root: string;
  let repoDir: string;

  beforeEach(async () => {
    seenPaths.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'create-from-prs-'));
    const bare = path.join(root, 'origin.git');
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(bare);
    await git(['init', '--bare'], bare);
    await git(['clone', bare, repoDir], root);
  });

  afterEach(() => {
    testDb.exec('DELETE FROM repos');
    removeDirSync(root);
  });

  function registerRepo(id: string): void {
    testDb.prepare('INSERT INTO repos (id, path, alias) VALUES (?, ?, ?)').run(id, repoDir, id);
  }

  it('has no GitHub repository when no remote is on GitHub', async () => {
    registerRepo('repo-local');

    expect(await readRepoGitHubRepository('repo-local')).toEqual({
      success: true,
      data: { repositoryUrl: null },
    });
  });

  it('reads the GitHub repository from a remote other than origin', async () => {
    registerRepo('repo-upstream');
    await git(['remote', 'add', 'upstream', 'https://github.com/acme/api.git'], repoDir);

    expect(await readRepoGitHubRepository('repo-upstream')).toEqual({
      success: true,
      data: { repositoryUrl: 'https://github.com/acme/api' },
    });
  });

  it('refuses a repository id that is not registered', async () => {
    const repository = await readRepoGitHubRepository('repo-unknown');
    const pulls = await listRepoPullRequests({ repoId: 'repo-unknown' }, readOctokit);

    expect(repository.success).toBe(false);
    if (!repository.success) expect(repository.error.type).toBe('no_repo');
    expect(pulls.success).toBe(false);
    if (!pulls.success) expect(pulls.error.type).toBe('no_repo');
  });

  it('says a repository with no GitHub remote has no pull requests, without asking GitHub', async () => {
    registerRepo('repo-local');

    const result = await listRepoPullRequests({ repoId: 'repo-local' }, readOctokit);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('no_github_remote');
    expect(seenPaths).toHaveLength(0);
  });

  it("lists the open pull requests of the repository's GitHub remote", async () => {
    registerRepo('repo-upstream');
    await git(['remote', 'add', 'upstream', 'git@github.com:acme/api.git'], repoDir);

    const result = await listRepoPullRequests({ repoId: 'repo-upstream' }, readOctokit);

    expect(result).toEqual({
      success: true,
      data: [
        {
          owner: 'acme',
          repo: 'api',
          number: 12,
          title: 'Retry webhooks',
          url: 'https://github.com/acme/api/pull/12',
          authorLogin: 'alice',
          isDraft: false,
        },
      ],
    });
    expect(seenPaths).toEqual(['/repos/acme/api/pulls']);
  });

  it('names GitHub not being connected for a repository on GitHub', async () => {
    registerRepo('repo-upstream');
    await git(['remote', 'add', 'upstream', 'https://github.com/acme/api.git'], repoDir);

    const result = await listRepoPullRequests({ repoId: 'repo-upstream' }, () =>
      Promise.resolve(null)
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('not_connected');
  });
});
