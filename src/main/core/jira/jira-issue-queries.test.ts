import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listJiraIssues, searchJiraIssues } from './jira-issue-queries';

/**
 * The Jira provider's list and search, over a REAL HTTP server on loopback
 * (the provider uses one transport, `fetch`, so a loopback site reaches it).
 * Reading one issue by key has one path, `fetchJiraIssue`, and its callers
 * treat only `not_found` as an answer:
 *   - search: a key-shaped term that is no issue is still search text, so it
 *     falls through to JQL; any other failure is returned, not searched past;
 *   - list: a picker key deleted before it was read is skipped; any other
 *     failure fails the list.
 * A JQL search that fails is returned too — an empty one moves on to the next
 * candidate. JQL goes to `POST /rest/api/3/search/jql`: Jira Cloud answers
 * `/rest/api/3/search` with 410 Gone ("The requested API has been removed",
 * CHANGE-2046; probed 2026-10-03 on a public Cloud site).
 *
 * Each case uses its own site path, so nothing cached for one site (the
 * project keys a numeric search needs) leaks into another case.
 */

type Answer = { status: number; body: unknown };

interface SeenRequest {
  method: string;
  route: string;
  jql: string | null;
  authorization: string | undefined;
}

let server: Server;
let origin = '';
let seen: SeenRequest[] = [];
let siteCount = 0;

let answerSearch: (jql: string) => Answer;
let answerIssue: (key: string) => Answer;
let answerPicker: () => Answer;
let answerProjects: () => Answer;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(body));
  });
}

function route(
  method: string,
  path: string,
  body: string
): { route: string; answer: Answer; jql: string | null } {
  // `/<site>/rest/api/3/...` — the site segment is the case's own.
  const rest = path.replace(/^\/[^/]+/, '');
  if (method === 'POST' && rest === '/rest/api/3/search/jql') {
    const { jql } = JSON.parse(body) as { jql: string };
    return { route: 'search', answer: answerSearch(jql), jql };
  }
  if (method === 'GET' && rest === '/rest/api/3/issue/picker') {
    return { route: 'picker', answer: answerPicker(), jql: null };
  }
  if (method === 'GET' && rest === '/rest/api/3/project') {
    return { route: 'projects', answer: answerProjects(), jql: null };
  }
  const issue = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(rest);
  if (method === 'GET' && issue) {
    const key = decodeURIComponent(issue[1]);
    return { route: `issue ${key}`, answer: answerIssue(key), jql: null };
  }
  return {
    route: `${method} ${rest}`,
    answer: { status: 410, body: { errorMessages: ['Gone'] } },
    jql: null,
  };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const path = new URL(request.url ?? '/', 'http://loopback').pathname;
      const handled = route(request.method ?? '', path, body);
      seen.push({
        method: request.method ?? '',
        route: handled.route,
        jql: handled.jql,
        authorization: request.headers.authorization,
      });
      response
        .writeHead(handled.answer.status, { 'content-type': 'application/json' })
        .end(JSON.stringify(handled.answer.body));
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

let auth: { siteUrl: string; email: string; token: string };

beforeEach(() => {
  seen = [];
  auth = { siteUrl: `${origin}/site-${++siteCount}`, email: 'dev@acme.test', token: 'jira-token' };
  answerSearch = () => ({ status: 200, body: { issues: [] } });
  answerIssue = () => ({ status: 404, body: { errorMessages: ['Issue does not exist'] } });
  answerPicker = () => ({ status: 200, body: { sections: [] } });
  answerProjects = () => ({ status: 200, body: [] });
});

function rawIssue(key: string, summary: string) {
  return {
    id: key.replace(/\D/g, ''),
    key,
    fields: {
      summary,
      updated: '2026-10-01T10:00:00.000+0000',
      status: { name: 'In Progress' },
      project: { key: key.split('-')[0], name: 'Engineering' },
      assignee: { displayName: 'Dev One' },
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `About ${key}` }] }],
      },
    },
  };
}

function issueAnswer(...issues: ReturnType<typeof rawIssue>[]): Answer {
  return { status: 200, body: { issues, isLast: true } };
}

const identifiers = (result: { success: boolean; issues?: { identifier: string }[] }) =>
  result.issues?.map((issue) => issue.identifier);

describe('listJiraIssues', () => {
  it("lists the user's assigned issues, normalized with links back to the site", async () => {
    answerSearch = (jql) =>
      jql.startsWith('assignee = currentUser()')
        ? issueAnswer(rawIssue('ENG-1', 'Fix login redirect'))
        : issueAnswer();

    const result = await listJiraIssues(auth, 10);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.issues).toEqual([
      expect.objectContaining({
        provider: 'jira',
        identifier: 'ENG-1',
        title: 'Fix login redirect',
        url: `${auth.siteUrl}/browse/ENG-1`,
        description: 'About ENG-1',
        status: 'In Progress',
        project: 'Engineering',
        assignees: ['Dev One'],
      }),
    ]);
    expect(seen.map((r) => r.route)).toEqual(['search']);
    expect(seen[0].authorization).toBe(
      `Basic ${Buffer.from('dev@acme.test:jira-token').toString('base64')}`
    );
  });

  it('moves to the next JQL candidate only when one comes back empty', async () => {
    answerSearch = (jql) =>
      jql.startsWith('reporter = currentUser()')
        ? issueAnswer(rawIssue('ENG-2', 'Reported by me'))
        : issueAnswer();

    const result = await listJiraIssues(auth, 10);

    expect(identifiers(result)).toEqual(['ENG-2']);
    expect(seen.map((r) => r.jql?.split(' ')[0])).toEqual(['assignee', 'reporter']);
  });

  it('fails when a JQL search fails, instead of trying the next candidate', async () => {
    answerSearch = () => ({ status: 400, body: { errorMessages: ['Field assignee is broken'] } });

    const result = await listJiraIssues(auth, 10);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Field assignee is broken');
    expect(seen.map((r) => r.route)).toEqual(['search']);
  });

  it('reads recent picker keys when every search is empty, skipping only keys that are gone', async () => {
    answerPicker = () => ({
      status: 200,
      body: { sections: [{ issues: [{ key: 'ENG-3' }, { key: 'ENG-4' }, { key: 'ENG-5' }] }] },
    });
    answerIssue = (key) =>
      key === 'ENG-4'
        ? { status: 404, body: { errorMessages: ['Issue does not exist'] } }
        : { status: 200, body: rawIssue(key, `Recent ${key}`) };

    const result = await listJiraIssues(auth, 10);

    expect(identifiers(result)).toEqual(['ENG-3', 'ENG-5']);
    expect(seen.filter((r) => r.route.startsWith('issue')).map((r) => r.route)).toEqual([
      'issue ENG-3',
      'issue ENG-4',
      'issue ENG-5',
    ]);
  });

  it('fails when a picker key cannot be read for any reason other than being gone', async () => {
    answerPicker = () => ({
      status: 200,
      body: { sections: [{ issues: [{ key: 'ENG-3' }, { key: 'ENG-6' }] }] },
    });
    answerIssue = (key) =>
      key === 'ENG-6'
        ? { status: 500, body: { errorMessages: ['Internal server error'] } }
        : { status: 200, body: rawIssue(key, `Recent ${key}`) };

    const result = await listJiraIssues(auth, 10);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Internal server error');
  });

  it('fails when the picker fails', async () => {
    answerPicker = () => ({ status: 503, body: { errorMessages: ['Picker unavailable'] } });

    const result = await listJiraIssues(auth, 10);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Picker unavailable');
  });

  it('is an empty list when Jira has nothing to show', async () => {
    expect(await listJiraIssues(auth, 10)).toEqual({ success: true, issues: [] });
  });
});

describe('searchJiraIssues', () => {
  it('reads a key-shaped term as that issue, without a JQL search', async () => {
    answerIssue = (key) =>
      key === 'ENG-3'
        ? { status: 200, body: rawIssue('ENG-3', 'Exact match') }
        : { status: 404, body: { errorMessages: ['Issue does not exist'] } };

    const result = await searchJiraIssues(auth, 'eng-3', 20);

    expect(identifiers(result)).toEqual(['ENG-3']);
    expect(seen.map((r) => r.route)).toEqual(['issue ENG-3']);
  });

  it('searches the text when a key-shaped term is no issue', async () => {
    answerSearch = () => issueAnswer(rawIssue('ENG-10', 'Mentions ENG-9'));

    const result = await searchJiraIssues(auth, 'ENG-9', 20);

    expect(identifiers(result)).toEqual(['ENG-10']);
    expect(seen.map((r) => r.route)).toEqual(['issue ENG-9', 'search']);
    expect(seen[1].jql).toBe('text ~ "ENG-9" OR issueKey = ENG-9');
  });

  it('returns the failure when a key-shaped term cannot be read, without searching past it', async () => {
    answerIssue = () => ({ status: 401, body: { errorMessages: ['Unauthorized'] } });

    const result = await searchJiraIssues(auth, 'ENG-3', 20);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Unauthorized');
    expect(seen.map((r) => r.route)).toEqual(['issue ENG-3']);
  });

  it('searches a number as text and as that number in every project', async () => {
    answerProjects = () => ({ status: 200, body: [{ key: 'ENG' }, { key: 'OPS' }] });
    answerSearch = () => issueAnswer(rawIssue('OPS-42', 'Ops forty-two'));

    const result = await searchJiraIssues(auth, '42', 20);

    expect(identifiers(result)).toEqual(['OPS-42']);
    expect(seen.find((r) => r.route === 'search')?.jql).toBe(
      'text ~ "42" OR key IN ("ENG-42","OPS-42")'
    );
  });

  it('fails when the projects for a numeric search cannot be read', async () => {
    answerProjects = () => ({ status: 500, body: { errorMessages: ['Projects unavailable'] } });

    const result = await searchJiraIssues(auth, '42', 20);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Projects unavailable');
    expect(seen.some((r) => r.route === 'search')).toBe(false);
  });

  it('escapes quotes in the searched text', async () => {
    await searchJiraIssues(auth, 'say "hi"', 20);

    expect(seen.map((r) => r.jql)).toEqual(['text ~ "say \\"hi\\""']);
  });

  it('fails when the JQL search fails', async () => {
    answerSearch = () => ({ status: 400, body: { errorMessages: ['Bad JQL'] } });

    const result = await searchJiraIssues(auth, 'login', 20);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Bad JQL');
  });

  it('asks nothing of Jira for a blank term', async () => {
    expect(await searchJiraIssues(auth, '   ', 20)).toEqual({ success: true, issues: [] });
    expect(seen).toEqual([]);
  });
});
