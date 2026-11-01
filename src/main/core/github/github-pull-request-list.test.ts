import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Octokit } from '@octokit/rest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listGitHubPullRequests } from './github-pull-request-list';

/**
 * The PRs tab of Create from… (plan §Phase 3 slice 2): the repository's open
 * pull requests, read live from GitHub, and searched there when the user types.
 * Over a REAL HTTP server on loopback with a real Octokit — what is worth
 * proving is what reaches the wire (open PRs of exactly this repository; a
 * search scoped to `repo:<owner>/<repo> is:pr is:open`) and that a failure is
 * named rather than answered with an empty list, which would read as "no pull
 * requests".
 */

interface SeenRequest {
  path: string;
  query: URLSearchParams;
}

let server: Server;
let origin = '';
const seen: SeenRequest[] = [];

function restPull(number: number, title: string, login: string, draft: boolean) {
  return {
    number,
    title,
    html_url: `https://github.com/acme/api/pull/${number}`,
    draft,
    user: { login },
    head: { ref: `feat/${number}` },
  };
}

function answer(path: string, query: URLSearchParams): { status: number; body: unknown } | null {
  if (path === '/repos/acme/api/pulls') {
    return {
      status: 200,
      body: [restPull(12, 'Retry webhooks', 'alice', false), restPull(9, 'Drop v1', 'bob', true)],
    };
  }
  if (path === '/search/issues' && (query.get('q') ?? '').includes('repo:acme/api')) {
    return {
      status: 200,
      body: {
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            number: 12,
            title: 'Retry webhooks',
            html_url: 'https://github.com/acme/api/pull/12',
            draft: false,
            user: { login: 'alice' },
            pull_request: { url: 'https://api.github.com/repos/acme/api/pulls/12' },
          },
        ],
      },
    };
  }
  if (path === '/repos/acme/revoked/pulls')
    return { status: 401, body: { message: 'Bad credentials' } };
  if (path === '/repos/acme/missing/pulls') return { status: 404, body: { message: 'Not Found' } };
  if (path === '/repos/acme/broken/pulls')
    return { status: 500, body: { message: 'Server Error' } };
  return null;
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://loopback');
    seen.push({ path: url.pathname, query: url.searchParams });
    const found = answer(url.pathname, url.searchParams);
    if (!found) {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    response
      .writeHead(found.status, { 'content-type': 'application/json' })
      .end(JSON.stringify(found.body));
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
  seen.length = 0;
});

const octokit = () => new Octokit({ baseUrl: origin, auth: 'ghp_test' });

describe('listGitHubPullRequests', () => {
  it("lists the repository's open pull requests, newest activity first", async () => {
    const result = await listGitHubPullRequests(octokit(), { owner: 'acme', repo: 'api' }, {});

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
        {
          owner: 'acme',
          repo: 'api',
          number: 9,
          title: 'Drop v1',
          url: 'https://github.com/acme/api/pull/9',
          authorLogin: 'bob',
          isDraft: true,
        },
      ],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe('/repos/acme/api/pulls');
    expect(seen[0].query.get('state')).toBe('open');
    expect(seen[0].query.get('sort')).toBe('updated');
  });

  it('searches open pull requests of this repository only', async () => {
    const result = await listGitHubPullRequests(
      octokit(),
      { owner: 'acme', repo: 'api' },
      { searchTerm: '  webhooks ' }
    );

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
    expect(seen[0].path).toBe('/search/issues');
    const q = seen[0].query.get('q') ?? '';
    expect(q).toContain('webhooks');
    expect(q).toContain('repo:acme/api');
    expect(q).toContain('is:pr');
    expect(q).toContain('is:open');
  });

  it('lists rather than searches for a blank search term', async () => {
    await listGitHubPullRequests(octokit(), { owner: 'acme', repo: 'api' }, { searchTerm: '   ' });

    expect(seen.map((request) => request.path)).toEqual(['/repos/acme/api/pulls']);
  });

  it('names GitHub not being connected, without a request', async () => {
    const result = await listGitHubPullRequests(null, { owner: 'acme', repo: 'api' }, {});

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('not_connected');
    expect(seen).toHaveLength(0);
  });

  it('names a rejected token as not connected', async () => {
    const result = await listGitHubPullRequests(octokit(), { owner: 'acme', repo: 'revoked' }, {});

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('not_connected');
  });

  it('names a repository GitHub does not show this account', async () => {
    const result = await listGitHubPullRequests(octokit(), { owner: 'acme', repo: 'missing' }, {});

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('error');
    expect(result.error.message).toContain('acme/missing');
  });

  it('names any other failure with what GitHub said, never an empty list', async () => {
    const result = await listGitHubPullRequests(octokit(), { owner: 'acme', repo: 'broken' }, {});

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('error');
    expect(result.error.message).toContain('Server Error');
  });
});
