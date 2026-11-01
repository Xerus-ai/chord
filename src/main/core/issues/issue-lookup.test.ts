import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LinearClient } from '@linear/sdk';
import { Octokit } from '@octokit/rest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getGitHubIssue } from '@main/core/github/github-issue-lookup';
import { getJiraIssue } from '@main/core/jira/jira-issue-lookup';
import { getLinearIssue } from '@main/core/linear/linear-issue-lookup';

/**
 * `getIssue(ref)` for each provider, over a REAL HTTP server on loopback and
 * the providers' real clients (Octokit, LinearClient, fetch) pointed at it.
 * What is worth proving is what reaches the wire — a GitHub URL is read from
 * the owner/repo it names — and that each way a lookup can fail lands on its
 * own named reason (`not_connected | not_found | error`), which the create
 * dialog shows instead of a title. A stubbed client would only prove the stub.
 *
 * The Linear query is pinned to `issues(filter: { team.key, number })` with
 * variables `{ teamKey, number }`: an empty `nodes` is then an unambiguous
 * "not found", with no guessing at the shape of Linear's error payloads.
 */

interface SeenRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: string;
}

let server: Server;
let origin = '';
const seen: SeenRequest[] = [];

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(body));
  });
}

function json(status: number, payload: unknown) {
  return { status, body: JSON.stringify(payload) };
}

function answerGitHub(path: string) {
  switch (path) {
    case '/repos/cli/cli/issues/2':
      return json(200, {
        number: 2,
        title: 'Reimagine how the app determines its context',
        html_url: 'https://github.com/cli/cli/issues/2',
        state: 'closed',
      });
    case '/repos/acme/missing/issues/9':
      return json(404, { message: 'Not Found' });
    case '/repos/acme/revoked/issues/1':
      return json(401, { message: 'Bad credentials' });
    case '/repos/acme/broken/issues/1':
      return json(500, { message: 'Server Error' });
    default:
      return null;
  }
}

function answerLinear(body: string) {
  const { variables } = JSON.parse(body) as { variables: { teamKey: string; number: number } };
  if (variables.teamKey === 'ENG' && variables.number === 42) {
    return json(200, {
      data: {
        issues: {
          nodes: [
            {
              identifier: 'ENG-42',
              title: 'Fix login redirect',
              url: 'https://linear.app/acme/issue/ENG-42/fix-login-redirect',
            },
          ],
        },
      },
    });
  }
  if (variables.teamKey === 'BRK') return json(500, { errors: [{ message: 'Internal error' }] });
  return json(200, { data: { issues: { nodes: [] } } });
}

function answerJira(path: string) {
  switch (path) {
    case '/jira/rest/api/3/issue/ENG-42':
      return json(200, { key: 'ENG-42', fields: { summary: 'Fix login redirect' } });
    case '/jira/rest/api/3/issue/ENG-404':
      return json(404, { errorMessages: ['Issue does not exist or you do not have permission'] });
    case '/jira/rest/api/3/issue/ENG-401':
      return json(401, { errorMessages: ['Unauthorized'] });
    case '/jira/rest/api/3/issue/ENG-500':
      return json(500, { errorMessages: ['Internal server error'] });
    default:
      return null;
  }
}

beforeAll(async () => {
  server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const path = new URL(request.url ?? '/', 'http://loopback').pathname;
      seen.push({
        method: request.method ?? '',
        path,
        authorization: request.headers.authorization,
        body,
      });
      const answer = path.startsWith('/linear/')
        ? answerLinear(body)
        : path.startsWith('/jira/')
          ? answerJira(path)
          : answerGitHub(path);
      if (!answer) {
        response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(answer.body);
    })();
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

const github = () => new Octokit({ baseUrl: origin, auth: 'ghp_test' });
const linear = () =>
  new LinearClient({ apiKey: 'lin_api_test', apiUrl: `${origin}/linear/graphql` });
const jiraAuth = () => ({ siteUrl: `${origin}/jira`, email: 'dev@acme.test', token: 'jira-token' });

describe('getGitHubIssue', () => {
  it('reads the issue from the owner/repo its URL names, as a ticket with its title', async () => {
    const result = await getGitHubIssue(github(), { owner: 'cli', repo: 'cli', number: 2 });

    expect(result).toEqual({
      success: true,
      data: {
        provider: 'github',
        id: '2',
        url: 'https://github.com/cli/cli/issues/2',
        title: 'Reimagine how the app determines its context',
      },
    });
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /repos/cli/cli/issues/2']);
  });

  it('is not_connected without a GitHub client, and asks nothing of the network', async () => {
    const result = await getGitHubIssue(null, { owner: 'cli', repo: 'cli', number: 2 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('not_connected');
    expect(seen).toEqual([]);
  });

  it('is not_connected when GitHub rejects the token', async () => {
    const result = await getGitHubIssue(github(), { owner: 'acme', repo: 'revoked', number: 1 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_connected');
  });

  it('is not_found for an issue GitHub does not have', async () => {
    const result = await getGitHubIssue(github(), { owner: 'acme', repo: 'missing', number: 9 });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_found');
  });

  it('is error, with what GitHub said, for any other failure', async () => {
    const result = await getGitHubIssue(github(), { owner: 'acme', repo: 'broken', number: 1 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('error');
    expect(result.error.message).toContain('Server Error');
  });
});

describe('getLinearIssue', () => {
  it('reads an issue by its key, as a ticket with its title and URL', async () => {
    const result = await getLinearIssue(linear(), 'ENG-42');

    expect(result).toEqual({
      success: true,
      data: {
        provider: 'linear',
        id: 'ENG-42',
        url: 'https://linear.app/acme/issue/ENG-42/fix-login-redirect',
        title: 'Fix login redirect',
      },
    });
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0].body).variables).toEqual({ teamKey: 'ENG', number: 42 });
    expect(seen[0].authorization).toContain('lin_api_test');
  });

  it('is not_connected without a Linear client', async () => {
    const result = await getLinearIssue(null, 'ENG-42');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_connected');
    expect(seen).toEqual([]);
  });

  it('is not_found when Linear has no issue with that key', async () => {
    const result = await getLinearIssue(linear(), 'ENG-9999');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_found');
  });

  it('is error when Linear fails', async () => {
    const result = await getLinearIssue(linear(), 'BRK-1');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('error');
  });
});

describe('getJiraIssue', () => {
  it('reads an issue by its key on the connected site, as a ticket linking back to it', async () => {
    const result = await getJiraIssue(jiraAuth(), 'ENG-42');

    expect(result).toEqual({
      success: true,
      data: {
        provider: 'jira',
        id: 'ENG-42',
        url: `${origin}/jira/browse/ENG-42`,
        title: 'Fix login redirect',
      },
    });
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /jira/rest/api/3/issue/ENG-42']);
    expect(seen[0].authorization).toBe(
      `Basic ${Buffer.from('dev@acme.test:jira-token').toString('base64')}`
    );
  });

  it('is not_connected without Jira credentials', async () => {
    const result = await getJiraIssue(null, 'ENG-42');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_connected');
    expect(seen).toEqual([]);
  });

  it('is not_connected when Jira rejects the credentials', async () => {
    const result = await getJiraIssue(jiraAuth(), 'ENG-401');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_connected');
  });

  it('is not_found for a key Jira does not have', async () => {
    const result = await getJiraIssue(jiraAuth(), 'ENG-404');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('not_found');
  });

  it('is error, with what Jira said, for any other failure', async () => {
    const result = await getJiraIssue(jiraAuth(), 'ENG-500');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('error');
    expect(result.error.message).toContain('Internal server error');
  });
});
