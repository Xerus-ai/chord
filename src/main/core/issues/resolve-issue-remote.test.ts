import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseGitHubRepository } from '@shared/github-repository';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { GitHubIssueServiceImpl } from '@main/core/github/services/issue-service';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { resolveIssueQueryRemote } from './resolve-issue-remote';

/**
 * `issues.listIssues/searchIssues` with a `projectId` read the project's
 * configured remote — and passed its NAME (`origin`) where the GitHub provider
 * parses a URL, so listing by project always answered "Repository URL is
 * required." The remote is now its URL, read from the project's own git
 * config. Real repositories, the real git-backed repository service, and the
 * real issue service over a loopback server standing in for api.github.com.
 */

// The issue service's module graph reaches the app database (through the
// GitHub token store); it opens the REAL SQLite test database instead of
// resolving Electron's profile folder.
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
    if (url.pathname !== '/repos/acme/api/issues') {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify([
        {
          number: 7,
          title: 'Retry failed webhooks',
          html_url: 'https://github.com/acme/api/issues/7',
          state: 'open',
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-02T00:00:00Z',
          comments: 0,
          user: { login: 'alice', avatar_url: 'https://avatar.test/alice' },
          assignees: [],
          labels: [],
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

describe('resolveIssueQueryRemote', () => {
  let repoDir: string;

  beforeEach(async () => {
    seenPaths.length = 0;
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-remote-'));
    await git(['init'], repoDir);
  });

  afterEach(() => {
    removeDirSync(repoDir);
  });

  /** The project's repository service as `createProjectProvider` builds it, on this checkout. */
  function repositoryFor(configuredRemote: string): GitRepositoryService {
    const ctx = new LocalExecutionContext({ root: repoDir });
    return new GitRepositoryService(new GitService(ctx, ctx, new LocalFileSystem(repoDir)), {
      getRemote: () => Promise.resolve(configuredRemote),
      getDefaultBranch: () => Promise.resolve('main'),
    });
  }

  it('passes the configured remote’s URL, from which GitHub issues are listed', async () => {
    await git(['remote', 'add', 'origin', 'git@github.com:acme/api.git'], repoDir);
    const repository = repositoryFor('origin');

    const opts = await resolveIssueQueryRemote({ projectId: 'project-1', limit: 5 }, (id) =>
      id === 'project-1' ? repository : undefined
    );

    expect(opts).toEqual({
      projectId: 'project-1',
      limit: 5,
      remote: 'git@github.com:acme/api.git',
    });
    const githubRepository = parseGitHubRepository(opts.remote);
    expect(githubRepository?.nameWithOwner).toBe('acme/api');
    const service = new GitHubIssueServiceImpl(() =>
      Promise.resolve(new Octokit({ baseUrl: origin, auth: 'ghp_test' }))
    );
    const issues = await service.listIssues(githubRepository!, 5);
    expect(issues.map((issue) => [issue.number, issue.title])).toEqual([
      [7, 'Retry failed webhooks'],
    ]);
    expect(seenPaths).toEqual(['/repos/acme/api/issues']);
  });

  it('reads the remote the project is configured for, not origin', async () => {
    await git(['remote', 'add', 'origin', 'https://gitlab.com/acme/api.git'], repoDir);
    await git(['remote', 'add', 'upstream', 'https://github.com/acme/api.git'], repoDir);

    const opts = await resolveIssueQueryRemote({ projectId: 'project-1' }, () =>
      repositoryFor('upstream')
    );

    expect(opts.remote).toBe('https://github.com/acme/api.git');
  });

  it('leaves a query without a project as it is', async () => {
    const opts = await resolveIssueQueryRemote(
      { repositoryUrl: 'https://github.com/acme/api' },
      () => {
        throw new Error('no project is read for a query without one');
      }
    );

    expect(opts).toEqual({ repositoryUrl: 'https://github.com/acme/api' });
  });

  it('throws for a project that is not open, instead of listing without a remote', async () => {
    await expect(
      resolveIssueQueryRemote({ projectId: 'project-gone' }, () => undefined)
    ).rejects.toThrow('project-gone');
  });
});
