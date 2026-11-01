import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Octokit } from '@octokit/rest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getGitHubPullRequestHead } from './github-pull-request-head';

/**
 * A pasted PR URL is an explicit pick of the PR's head (plan §Phase 3 slice
 * 1). Over a REAL HTTP server on loopback with a real Octokit: the head is
 * read from the owner/repo the URL names, and everything `gh pr checkout`
 * needs to check it out comes back — same-repo or fork, whether the fork
 * accepts maintainer pushes, and whether the fork still exists (a deleted
 * fork still checks out through `refs/pull/<n>/head`). Each failure has its
 * own reason.
 */

let server: Server;
let origin = '';
const seenPaths: string[] = [];

const BASE_REPO = { full_name: 'cli/cli', name: 'cli', owner: { login: 'cli' } };

function pull(
  number: number,
  head: { ref: string; login: string; repo: { owner: string; name: string } | null },
  maintainerCanModify: boolean
) {
  return {
    number,
    title: `PR ${number} title`,
    html_url: `https://github.com/cli/cli/pull/${number}`,
    maintainer_can_modify: maintainerCanModify,
    head: {
      ref: head.ref,
      label: `${head.login}:${head.ref}`,
      user: { login: head.login },
      repo:
        head.repo === null
          ? null
          : {
              full_name: `${head.repo.owner}/${head.repo.name}`,
              name: head.repo.name,
              owner: { login: head.repo.owner },
              clone_url: `https://github.com/${head.repo.owner}/${head.repo.name}.git`,
            },
    },
    base: { ref: 'trunk', repo: BASE_REPO },
  };
}

const ANSWERS: Record<string, { status: number; body: unknown }> = {
  '/repos/cli/cli/pulls/14577': {
    status: 200,
    body: pull(
      14577,
      {
        ref: 'williammartin-profile-startup-cost',
        login: 'williammartin',
        repo: { owner: 'cli', name: 'cli' },
      },
      false
    ),
  },
  '/repos/cli/cli/pulls/14586': {
    status: 200,
    body: pull(
      14586,
      {
        ref: 'fix/display-url-escaped-path',
        login: 'bodapatisaikrishna',
        repo: { owner: 'bodapatisaikrishna', name: 'cli' },
      },
      true
    ),
  },
  '/repos/cli/cli/pulls/14585': {
    status: 200,
    body: pull(
      14585,
      { ref: 'patch-1', login: 'zainnadeem786', repo: { owner: 'zainnadeem786', name: 'cli' } },
      false
    ),
  },
  '/repos/cli/cli/pulls/14000': {
    status: 200,
    body: pull(14000, { ref: 'gone', login: 'departed', repo: null }, false),
  },
  '/repos/cli/cli/pulls/13000': {
    status: 200,
    body: pull(13000, { ref: '--upload-pack=evil', login: 'mallory', repo: null }, false),
  },
  '/repos/cli/cli/pulls/1': { status: 404, body: { message: 'Not Found' } },
  '/repos/cli/cli/pulls/2': { status: 502, body: { message: 'Bad Gateway' } },
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://loopback').pathname;
    seenPaths.push(path);
    const answer = ANSWERS[path] ?? { status: 404, body: { message: 'Not Found' } };
    response
      .writeHead(answer.status, { 'content-type': 'application/json' })
      .end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

beforeEach(() => {
  seenPaths.length = 0;
});

const github = () => new Octokit({ baseUrl: origin, auth: 'ghp_test' });
const ref = (number: number) => ({ owner: 'cli', repo: 'cli', number });

describe('getGitHubPullRequestHead', () => {
  it('resolves a same-repository PR to its head branch', async () => {
    const result = await getGitHubPullRequestHead(github(), ref(14577));

    expect(result).toEqual({
      success: true,
      data: {
        number: 14577,
        title: 'PR 14577 title',
        url: 'https://github.com/cli/cli/pull/14577',
        headRef: 'williammartin-profile-startup-cost',
        headOwner: 'cli',
        headRepo: 'cli/cli',
        headCloneUrl: 'https://github.com/cli/cli.git',
        crossRepository: false,
        maintainerCanModify: false,
      },
    });
    expect(seenPaths).toEqual(['/repos/cli/cli/pulls/14577']);
  });

  it('resolves a fork PR that accepts maintainer pushes, with the fork to push to', async () => {
    const result = await getGitHubPullRequestHead(github(), ref(14586));

    expect(result).toEqual({
      success: true,
      data: {
        number: 14586,
        title: 'PR 14586 title',
        url: 'https://github.com/cli/cli/pull/14586',
        headRef: 'fix/display-url-escaped-path',
        headOwner: 'bodapatisaikrishna',
        headRepo: 'bodapatisaikrishna/cli',
        headCloneUrl: 'https://github.com/bodapatisaikrishna/cli.git',
        crossRepository: true,
        maintainerCanModify: true,
      },
    });
  });

  it('resolves a fork PR that does not accept maintainer pushes', async () => {
    const result = await getGitHubPullRequestHead(github(), ref(14585));

    expect(result).toMatchObject({
      success: true,
      data: {
        headRef: 'patch-1',
        headOwner: 'zainnadeem786',
        headRepo: 'zainnadeem786/cli',
        crossRepository: true,
        maintainerCanModify: false,
      },
    });
  });

  it('resolves a PR whose fork was deleted, owned by the PR author, with nothing to push to', async () => {
    const result = await getGitHubPullRequestHead(github(), ref(14000));

    expect(result).toMatchObject({
      success: true,
      data: {
        number: 14000,
        headRef: 'gone',
        headOwner: 'departed',
        headRepo: null,
        headCloneUrl: null,
        crossRepository: true,
        maintainerCanModify: false,
      },
    });
  });

  it('refuses a head branch name git would read as an option, as gh does', async () => {
    const result = await getGitHubPullRequestHead(github(), ref(13000));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('error');
    expect(result.error.message).toContain('--upload-pack=evil');
  });

  it('is not_connected without a GitHub client, and asks nothing of the network', async () => {
    const result = await getGitHubPullRequestHead(null, ref(1));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_connected');
    expect(seenPaths).toEqual([]);
  });

  it('is not_found for a PR GitHub does not have', async () => {
    const result = await getGitHubPullRequestHead(github(), ref(1));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_found');
  });

  it('is error, with what GitHub said, for any other failure', async () => {
    const result = await getGitHubPullRequestHead(github(), ref(2));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('error');
    expect(result.error.message).toContain('Bad Gateway');
  });
});
