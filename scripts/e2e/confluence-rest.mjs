/**
 * The e2e side of Confluence (plan 2026-09-23 §4 P5): reads the test site's
 * credentials and checks what Chord published by asking Confluence directly,
 * never by trusting Chord's own report.
 *
 * Credentials: ~/.chord-e2e/confluence.env, or CHORD_E2E_CONFLUENCE_ENV —
 *   CONFLUENCE_URL, CONFLUENCE_USERNAME, CONFLUENCE_API_TOKEN, CONFLUENCE_TEST_SPACE_KEY
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function loadConfluenceTestEnv() {
  const path =
    process.env.CHORD_E2E_CONFLUENCE_ENV ?? join(homedir(), '.chord-e2e', 'confluence.env');
  if (!existsSync(path)) throw new Error(`Confluence test credentials not found: ${path}`);
  const env = Object.fromEntries(
    readFileSync(path, 'utf-8')
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => [
        line.slice(0, line.indexOf('=')).trim(),
        line.slice(line.indexOf('=') + 1).trim(),
      ])
  );
  for (const key of [
    'CONFLUENCE_URL',
    'CONFLUENCE_USERNAME',
    'CONFLUENCE_API_TOKEN',
    'CONFLUENCE_TEST_SPACE_KEY',
  ]) {
    if (!env[key]) throw new Error(`${path} is missing ${key}`);
  }
  return {
    siteUrl: new URL(env.CONFLUENCE_URL).origin,
    email: env.CONFLUENCE_USERNAME,
    token: env.CONFLUENCE_API_TOKEN,
    spaceKey: env.CONFLUENCE_TEST_SPACE_KEY,
  };
}

export function createConfluenceRest(env) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${env.email}:${env.token}`).toString('base64')}`,
    Accept: 'application/json',
    'User-Agent': 'Chord-e2e',
  };

  async function request(method, path, body) {
    const response = await fetch(new URL(path, env.siteUrl), {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`Confluence ${method} ${path} → ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    /** Pages in the test space with exactly this title, with version and storage body. */
    async findPagesByTitle(title) {
      const result = await request(
        'GET',
        `/wiki/rest/api/content?spaceKey=${encodeURIComponent(env.spaceKey)}&title=${encodeURIComponent(title)}&expand=version,body.storage`
      );
      return result.results.map((page) => ({
        id: page.id,
        version: page.version.number,
        storage: page.body.storage.value,
      }));
    },

    async listAttachments(pageId) {
      const result = await request('GET', `/wiki/api/v2/pages/${pageId}/attachments?limit=50`);
      return result.results.map((a) => ({
        title: a.title,
        mediaType: a.mediaType,
        fileSize: a.fileSize,
      }));
    },

    /** Someone edits the page in Confluence: a new version with an extra paragraph. */
    async appendParagraphRemotely(pageId, text) {
      const page = await request('GET', `/wiki/api/v2/pages/${pageId}?body-format=storage`);
      await request('PUT', `/wiki/api/v2/pages/${pageId}`, {
        id: pageId,
        status: 'current',
        title: page.title,
        body: { representation: 'storage', value: `${page.body.storage.value}<p>${text}</p>` },
        version: { number: page.version.number + 1, message: 'Edited in Confluence (e2e)' },
      });
    },

    async deletePage(pageId) {
      await request('DELETE', `/wiki/api/v2/pages/${pageId}`);
    },
  };
}
