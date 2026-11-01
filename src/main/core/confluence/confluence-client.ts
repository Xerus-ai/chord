import type { ConfluenceSpace } from '@shared/confluence';

/**
 * Confluence Cloud REST, authenticated as the connected account with an API
 * token (Basic email:token), Atlassian's scheme for API tokens. Pages go
 * through the v2 API; attachments only exist in v1.
 */

export interface ConfluenceAuth {
  /** Site origin, e.g. https://acme.atlassian.net — no `/wiki`. */
  siteUrl: string;
  email: string;
  token: string;
}

export class ConfluenceApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ConfluenceApiError';
  }
}

export interface ConfluencePage {
  id: string;
  title: string;
  spaceId: string;
  version: number;
}

// Atlassian's XSRF filter refuses writes that carry a browser User-Agent, even
// with token auth; Electron's fetch sends
// Chrome's. Attachments also need X-Atlassian-Token: no-check.
const USER_AGENT = 'Chord';

function describeFailure(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      errors?: Array<{ title?: string; detail?: string }>;
    };
    const detail =
      parsed.errors?.map((e) => e.detail ?? e.title).find(Boolean) ?? parsed.message ?? '';
    if (detail) return `Confluence ${status}: ${detail}`;
  } catch {
    // Not JSON: the raw text below is the most specific thing there is.
  }
  return `Confluence ${status}: ${body.slice(0, 300) || 'no response body'}`;
}

async function requestConfluence(
  auth: ConfluenceAuth,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: { json: unknown } | { form: FormData }
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}`,
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    'X-Atlassian-Token': 'no-check',
  };
  let payload: string | FormData | undefined;
  if (body && 'json' in body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body.json);
  } else if (body) {
    payload = body.form;
  }
  const response = await fetch(new URL(path, auth.siteUrl), { method, headers, body: payload });
  const text = await response.text();
  if (!response.ok)
    throw new ConfluenceApiError(describeFailure(response.status, text), response.status);
  return text ? JSON.parse(text) : null;
}

export async function fetchCurrentUser(
  auth: ConfluenceAuth
): Promise<{ accountId: string; displayName: string }> {
  const user = (await requestConfluence(auth, 'GET', '/wiki/rest/api/user/current')) as {
    accountId?: string;
    displayName?: string;
    type?: string;
  };
  if (!user?.accountId || user.type === 'anonymous') {
    throw new Error('Confluence did not accept these credentials.');
  }
  return { accountId: user.accountId, displayName: user.displayName ?? auth.email };
}

interface SpacePage {
  results: Array<{ id: string; key: string; name: string; type: string }>;
  _links?: { next?: string };
}

export async function listSpaces(auth: ConfluenceAuth): Promise<ConfluenceSpace[]> {
  const spaces: ConfluenceSpace[] = [];
  let next: string | undefined = '/wiki/api/v2/spaces?limit=250&status=current';
  while (next) {
    const page = (await requestConfluence(auth, 'GET', next)) as SpacePage;
    spaces.push(...page.results.map(({ id, key, name, type }) => ({ id, key, name, type })));
    next = page._links?.next;
  }
  return spaces.sort((a, b) => a.name.localeCompare(b.name));
}

export async function findSpaceByKey(auth: ConfluenceAuth, key: string): Promise<ConfluenceSpace> {
  const page = (await requestConfluence(
    auth,
    'GET',
    `/wiki/api/v2/spaces?keys=${encodeURIComponent(key)}`
  )) as SpacePage;
  const space = page.results[0];
  if (!space)
    throw new Error(`Confluence space ${key} was not found, or this account cannot see it.`);
  return { id: space.id, key: space.key, name: space.name, type: space.type };
}

interface PageResponse {
  id: string;
  title: string;
  spaceId: string;
  version: { number: number };
}

function toPage(response: PageResponse): ConfluencePage {
  return {
    id: response.id,
    title: response.title,
    spaceId: response.spaceId,
    version: response.version.number,
  };
}

export async function fetchPage(auth: ConfluenceAuth, pageId: string): Promise<ConfluencePage> {
  return toPage(
    (await requestConfluence(
      auth,
      'GET',
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`
    )) as PageResponse
  );
}

export async function createPage(
  auth: ConfluenceAuth,
  page: { spaceId: string; title: string; storage: string }
): Promise<ConfluencePage> {
  return toPage(
    (await requestConfluence(auth, 'POST', '/wiki/api/v2/pages', {
      json: {
        spaceId: page.spaceId,
        status: 'current',
        title: page.title,
        body: { representation: 'storage', value: page.storage },
      },
    })) as PageResponse
  );
}

export async function updatePage(
  auth: ConfluenceAuth,
  page: { pageId: string; title: string; storage: string; nextVersion: number }
): Promise<ConfluencePage> {
  return toPage(
    (await requestConfluence(auth, 'PUT', `/wiki/api/v2/pages/${encodeURIComponent(page.pageId)}`, {
      json: {
        id: page.pageId,
        status: 'current',
        title: page.title,
        body: { representation: 'storage', value: page.storage },
        version: { number: page.nextVersion, message: 'Published from Chord' },
      },
    })) as PageResponse
  );
}

/** Creates the attachment, or a new version of it when one with that name exists. */
export async function uploadAttachment(
  auth: ConfluenceAuth,
  pageId: string,
  file: { fileName: string; contentType: string; data: Buffer }
): Promise<void> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(file.data)], { type: file.contentType }),
    file.fileName
  );
  form.append('minorEdit', 'true');
  await requestConfluence(
    auth,
    'PUT',
    `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`,
    { form }
  );
}
