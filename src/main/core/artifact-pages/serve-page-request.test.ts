import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Real SQLite from the shipped migrations (the repo's standard substitution,
 * see session-launch-model.test.ts): the handler resolves artifact rows and
 * work items through the same queries production runs.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts } = await import('@main/db/schema-artifacts');
const { handleArtifactPageRequest } = await import('./serve-page-request');
const { artifactPageCsp } = await import('./page-response-headers');
const {
  clearPageSourcesForTest,
  registerArtifactPageSource,
  registerArtifactVersionSource,
  registerEmbeddedMdxSource,
} = await import('./page-source-registry');
const { clearPreparedBundlesForTest } = await import('./prepare-page');

const WORK_ITEM_ID = 'w-page';
const HTML_ARTIFACT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

let root: string;
let repoDir: string;
let runtimeDir: string;
let secretOutsideRepo: string;

/** Every response carries the isolation headers, with the CSP pinned to the page's own origin. */
function expectIsolationHeaders(
  response: Response,
  pageId: string | null = HTML_ARTIFACT_ID
): void {
  expect(response.headers.get('Content-Security-Policy')).toBe(artifactPageCsp(pageId));
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
}

function request(path: string, pageId = HTML_ARTIFACT_ID): Request {
  return new Request(`chord-artifact://${pageId}${path}`);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'chord-pages-'));
  repoDir = join(root, 'repo');
  runtimeDir = join(root, 'runtime');
  mkdirSync(join(repoDir, 'site', 'assets'), { recursive: true });
  mkdirSync(join(runtimeDir, 'chunks'), { recursive: true });
  writeFileSync(
    join(repoDir, 'site', 'index.html'),
    '<!doctype html><html><head><title>t</title></head><body><script>document.title="ran"</script></body></html>'
  );
  writeFileSync(join(repoDir, 'site', 'assets', 'style.css'), 'body{margin:0}');
  writeFileSync(join(repoDir, 'site', 'page.mdx'), '# hi');
  secretOutsideRepo = join(root, 'secret.txt');
  writeFileSync(secretOutsideRepo, 'do not serve');
  writeFileSync(join(repoDir, 'secret-sibling.txt'), 'outside the page dir');
  // A directory link inside the page directory that points outside it. A
  // junction needs no privilege on Windows; on POSIX it is a plain symlink.
  mkdirSync(join(root, 'linked-target'));
  writeFileSync(join(root, 'linked-target', 'leak.txt'), 'reached through a link');
  symlinkSync(join(root, 'linked-target'), join(repoDir, 'site', 'link'), 'junction');
  writeFileSync(join(runtimeDir, 'tokens.css'), ':root{}');
  writeFileSync(join(runtimeDir, 'chord-page.js'), '// bridge');
  writeFileSync(join(runtimeDir, 'chunks', 'mermaid.core-ABC.js'), '// chunk');

  await db.insert(repos).values({ id: 'r-page', alias: 'site', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-page',
    repoPath: repoDir,
    name: 'Pages',
  });
  await db.insert(artifacts).values({
    id: HTML_ARTIFACT_ID,
    workItemId: WORK_ITEM_ID,
    filePath: join(repoDir, 'site', 'index.html'),
    name: 'index.html',
    type: 'web',
    contentType: 'web',
  });
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(async () => {
  clearPageSourcesForTest();
  clearPreparedBundlesForTest();
  await registerArtifactPageSource(HTML_ARTIFACT_ID);
});

describe('handleArtifactPageRequest — isolation headers on every response', () => {
  it('carries the CSP, nosniff and no-referrer on the page document', async () => {
    const response = await handleArtifactPageRequest(request('/'), runtimeDir);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expectIsolationHeaders(response);
    const html = await response.text();
    expect(html).toContain(`chord-artifact://${HTML_ARTIFACT_ID}/__chord/tokens.css`);
    expect(html).toContain(`chord-artifact://${HTML_ARTIFACT_ID}/__chord/chord-page.js`);
    // The author's inline script is preserved verbatim.
    expect(html).toContain('<script>document.title="ran"</script>');
    // Host assets are injected as the FIRST children of <head>.
    expect(html.indexOf('__chord/tokens.css')).toBeLessThan(html.indexOf('<title>'));
  });

  it('carries the headers on an authored asset', async () => {
    const response = await handleArtifactPageRequest(request('/assets/style.css'), runtimeDir);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/css');
    expectIsolationHeaders(response);
  });

  it('carries the headers on a host runtime asset and a code-split chunk', async () => {
    const tokens = await handleArtifactPageRequest(request('/__chord/tokens.css'), runtimeDir);
    expect(tokens.status).toBe(200);
    expectIsolationHeaders(tokens);
    const chunk = await handleArtifactPageRequest(
      request('/__chord/chunks/mermaid.core-ABC.js'),
      runtimeDir
    );
    expect(chunk.status).toBe(200);
    expect(chunk.headers.get('Content-Type')).toContain('text/javascript');
    expectIsolationHeaders(chunk);
  });

  it('carries the headers on a 404 and on an unknown page id', async () => {
    const missing = await handleArtifactPageRequest(request('/assets/nope.css'), runtimeDir);
    expect(missing.status).toBe(404);
    expectIsolationHeaders(missing);

    const unknown = await handleArtifactPageRequest(request('/', 'not-registered'), runtimeDir);
    expect(unknown.status).toBe(404);
    expectIsolationHeaders(unknown, null);
  });

  it('refuses non-GET methods, with headers', async () => {
    const response = await handleArtifactPageRequest(
      new Request(`chord-artifact://${HTML_ARTIFACT_ID}/`, { method: 'POST' }),
      runtimeDir
    );
    expect(response.status).toBe(405);
    expectIsolationHeaders(response, null);
  });

  it('answers HEAD with the same headers as GET', async () => {
    const response = await handleArtifactPageRequest(
      new Request(`chord-artifact://${HTML_ARTIFACT_ID}/`, { method: 'HEAD' }),
      runtimeDir
    );
    expect(response.status).toBe(200);
    expectIsolationHeaders(response);
  });

  it("pins script and style sources to the page's own origin, not the whole scheme", () => {
    const csp = artifactPageCsp(HTML_ARTIFACT_ID);
    expect(csp).toContain(`script-src 'unsafe-inline' chord-artifact://${HTML_ARTIFACT_ID}`);
    expect(csp).not.toMatch(/chord-artifact:(;|\s|$)/);
    expect(artifactPageCsp(null)).toContain("script-src 'none'");
  });

  it('serves a stored version from its content at its own origin', async () => {
    const version = await registerArtifactVersionSource({
      artifactId: HTML_ARTIFACT_ID,
      versionId: 'v-1',
      content: '<html><head></head><body><p id="old">version one</p></body></html>',
    });
    expect(version.pageId).not.toBe(HTML_ARTIFACT_ID);
    const response = await handleArtifactPageRequest(request('/', version.pageId), runtimeDir);
    expect(response.status).toBe(200);
    expectIsolationHeaders(response, version.pageId);
    const html = await response.text();
    expect(html).toContain('version one');
    expect(html).not.toContain('document.title="ran"');
    // Relative assets still come from the live page directory.
    const css = await handleArtifactPageRequest(
      request('/assets/style.css', version.pageId),
      runtimeDir
    );
    expect(css.status).toBe(200);
  });
});

describe('handleArtifactPageRequest — path escape', () => {
  // Dot segments — literal or percent-encoded — are collapsed by URL parsing
  // before the handler sees them (Chromium canonicalises the same way), so
  // they cannot climb out: they land on a sibling that does not exist.
  it.each([
    '/../secret-sibling.txt',
    '/assets/../../secret-sibling.txt',
    '/%2e%2e/secret-sibling.txt',
  ])('never serves %s from outside the page directory', async (path) => {
    const response = await handleArtifactPageRequest(request(path), runtimeDir);
    expect(response.status).toBe(404);
    expectIsolationHeaders(response);
    expect(await response.text()).not.toContain('outside the page dir');
  });

  // These survive URL parsing intact and are the handler's own job to refuse.
  it.each([
    '/assets/..%5c..%5csecret-sibling.txt',
    '/..%5csecret-sibling.txt',
    '/C:/Windows/win.ini',
    '/%5c%5cserver%5cshare%5cfile.txt',
  ])('rejects %s with 403 before reading anything', async (path) => {
    const response = await handleArtifactPageRequest(request(path), runtimeDir);
    expect(response.status).toBe(403);
    expectIsolationHeaders(response);
    expect(await response.text()).not.toContain('outside the page dir');
  });

  it('refuses a directory link that leaves the page directory', async () => {
    const response = await handleArtifactPageRequest(request('/link/leak.txt'), runtimeDir);
    expect(response.status).toBe(403);
    expectIsolationHeaders(response);
    expect(await response.text()).not.toContain('reached through a link');
  });

  it('does not put the file path into a 404 body', async () => {
    clearPageSourcesForTest();
    await db
      .insert(artifacts)
      .values({
        id: 'a1b2c3d4-0000-4000-8000-000000000002',
        workItemId: WORK_ITEM_ID,
        filePath: join(repoDir, 'site', 'gone.html'),
        name: 'gone.html',
        type: 'web',
        contentType: 'web',
      })
      .onConflictDoNothing();
    const source = await registerArtifactPageSource('a1b2c3d4-0000-4000-8000-000000000002');
    const response = await handleArtifactPageRequest(request('/', source.pageId), runtimeDir);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(repoDir);
  });

  it('rejects host chunk names carrying an encoded separator', async () => {
    const encoded = await handleArtifactPageRequest(
      request('/__chord/chunks/..%2Ftokens.css'),
      runtimeDir
    );
    expect(encoded.status).toBe(404);
    expectIsolationHeaders(encoded);
  });

  it('serves nothing for a component page until its bundle is prepared', async () => {
    const source = registerEmbeddedMdxSource({
      filePath: join(repoDir, 'site', 'page.mdx'),
      workItemId: WORK_ITEM_ID,
    });
    const doc = await handleArtifactPageRequest(request('/', source.pageId), runtimeDir);
    expect(doc.status).toBe(409);
    expectIsolationHeaders(doc, source.pageId);
    // A component page has no authored asset directory to browse.
    const asset = await handleArtifactPageRequest(
      request('/index.html.bak', source.pageId),
      runtimeDir
    );
    expect(asset.status).toBe(404);
  });
});

describe('registerEmbeddedMdxSource', () => {
  it('rejects a component path outside the work item repository', () => {
    expect(() =>
      registerEmbeddedMdxSource({
        filePath: secretOutsideRepo.replace(/\.txt$/, '.mdx'),
        workItemId: WORK_ITEM_ID,
      })
    ).toThrow(/outside the work item repository/);
  });

  it('rejects a non-.mdx file', () => {
    expect(() =>
      registerEmbeddedMdxSource({ filePath: secretOutsideRepo, workItemId: WORK_ITEM_ID })
    ).toThrow(/\.mdx/);
  });
});
