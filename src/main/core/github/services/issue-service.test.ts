import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Octokit } from '@octokit/rest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getGitHubIssue } from '../github-issue-lookup';
import { issueService } from './issue-service';
import { getOctokit } from './octokit-provider';

vi.mock('./octokit-provider', () => ({
  getOctokit: vi.fn(),
}));

const mockGetOctokit = vi.mocked(getOctokit);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokit(overrides: {
  listForRepo?: ReturnType<typeof vi.fn>;
  issuesAndPullRequests?: ReturnType<typeof vi.fn>;
}): Octokit {
  return {
    rest: {
      issues: {
        listForRepo: overrides.listForRepo ?? vi.fn(),
      },
      search: {
        issuesAndPullRequests: overrides.issuesAndPullRequests ?? vi.fn(),
      },
    },
  } as unknown as Octokit;
}

const restIssue = {
  number: 1,
  title: 'Test issue',
  html_url: 'https://github.com/owner/repo/issues/1',
  state: 'open',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  comments: 3,
  user: { login: 'alice', avatar_url: 'https://avatar.test/alice' },
  assignees: [{ login: 'bob', avatar_url: 'https://avatar.test/bob' }],
  labels: [{ name: 'bug', color: 'fc2929' }],
};

const expectedIssue = {
  number: 1,
  title: 'Test issue',
  url: 'https://github.com/owner/repo/issues/1',
  state: 'open',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  comments: 3,
  user: { login: 'alice', avatarUrl: 'https://avatar.test/alice' },
  assignees: [{ login: 'bob', avatarUrl: 'https://avatar.test/bob' }],
  labels: [{ name: 'bug', color: 'fc2929' }],
};

const repository = {
  owner: 'owner',
  repo: 'repo',
  nameWithOwner: 'owner/repo',
  repositoryUrl: 'https://github.com/owner/repo',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubIssueServiceImpl', () => {
  describe('listIssues', () => {
    it('maps REST response to camelCase', async () => {
      const listForRepo = vi.fn().mockResolvedValue({ data: [restIssue] });
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      const result = await issueService.listIssues(repository, 30);

      expect(listForRepo).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        state: 'open',
        per_page: 30,
        sort: 'updated',
        direction: 'desc',
      });
      expect(result).toEqual([expectedIssue]);
    });

    it('filters out pull requests', async () => {
      const pr = { ...restIssue, number: 2, pull_request: { url: 'https://...' } };
      const listForRepo = vi.fn().mockResolvedValue({ data: [restIssue, pr] });
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      const result = await issueService.listIssues(repository);

      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
    });

    // An empty list on error read as "no open issues" in Create from…'s Issues
    // tab; the provider wraps the throw into a named failure instead.
    it('throws on error instead of answering an empty list', async () => {
      const listForRepo = vi.fn().mockRejectedValue(new Error('Network error'));
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      await expect(issueService.listIssues(repository)).rejects.toThrow('Network error');
    });

    it('clamps limit to 1-100', async () => {
      const listForRepo = vi.fn().mockResolvedValue({ data: [] });
      mockGetOctokit.mockResolvedValue(makeOctokit({ listForRepo }));

      await issueService.listIssues(repository, 0);
      expect(listForRepo).toHaveBeenCalledWith(expect.objectContaining({ per_page: 1 }));

      listForRepo.mockClear();
      await issueService.listIssues(repository, 999);
      expect(listForRepo).toHaveBeenCalledWith(expect.objectContaining({ per_page: 100 }));
    });
  });

  describe('searchIssues', () => {
    it('maps search results to camelCase', async () => {
      const issuesAndPullRequests = vi.fn().mockResolvedValue({ data: { items: [restIssue] } });
      mockGetOctokit.mockResolvedValue(makeOctokit({ issuesAndPullRequests }));

      const result = await issueService.searchIssues(repository, 'bug fix', 15);

      expect(issuesAndPullRequests).toHaveBeenCalledWith({
        q: 'bug fix repo:owner/repo is:issue is:open',
        per_page: 15,
        sort: 'updated',
        order: 'desc',
      });
      expect(result).toEqual([expectedIssue]);
    });

    it('returns empty for blank search term', async () => {
      const issuesAndPullRequests = vi.fn();
      mockGetOctokit.mockResolvedValue(makeOctokit({ issuesAndPullRequests }));

      expect(await issueService.searchIssues(repository, '   ')).toEqual([]);
      expect(await issueService.searchIssues(repository, '')).toEqual([]);
      expect(issuesAndPullRequests).not.toHaveBeenCalled();
    });

    it('throws on error instead of answering an empty list', async () => {
      const issuesAndPullRequests = vi.fn().mockRejectedValue(new Error('API error'));
      mockGetOctokit.mockResolvedValue(makeOctokit({ issuesAndPullRequests }));

      await expect(issueService.searchIssues(repository, 'query')).rejects.toThrow('API error');
    });
  });
});

/**
 * Reading one issue has one path: the typed `getGitHubIssue`, which replaced
 * the service's `getIssue` (it answered null for a missing issue, a revoked
 * token and an outage alike, and had no caller left). Over a REAL HTTP server
 * on loopback with a real Octokit, a missing issue is a named `not_found`,
 * never null.
 */
describe('reading one GitHub issue', () => {
  let server: Server;
  let origin = '';

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://loopback').pathname;
      if (path === '/repos/owner/repo/issues/42') {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ...restIssue, number: 42, body: 'Issue body' }));
        return;
      }
      response
        .writeHead(404, { 'content-type': 'application/json' })
        .end(JSON.stringify({ message: 'Not Found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  const octokit = () => new Octokit({ baseUrl: origin, auth: 'ghp_test' });

  it('is not a second, null-returning method on the service', () => {
    expect('getIssue' in issueService).toBe(false);
  });

  it('reads the issue as a ticket with its title', async () => {
    expect(await getGitHubIssue(octokit(), { owner: 'owner', repo: 'repo', number: 42 })).toEqual({
      success: true,
      data: {
        provider: 'github',
        id: '42',
        url: restIssue.html_url,
        title: restIssue.title,
      },
    });
  });

  it('names a missing issue not_found instead of answering null', async () => {
    const result = await getGitHubIssue(octokit(), { owner: 'owner', repo: 'repo', number: 99 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_found');
  });
});
