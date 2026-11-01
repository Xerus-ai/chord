import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_THEME_QUERY_PARAM } from '@shared/artifact-frame-constants';
import { removeDirSync } from '@main/lib/remove-dir-sync';

// The registry module reads artifact rows; real SQLite from the shipped
// migrations, the repo's standard substitution (serve-page-request.test.ts).
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { ArtifactViewMissingError, readCloudArtifactView } = await import('./cloud-page-view');
const { artifactPageCsp } = await import('./page-response-headers');
const { clearPageSourcesForTest, registerSnapshotPageSource } = await import(
  './page-source-registry'
);
const { clearPreparedBundlesForTest, preparePage } = await import('./prepare-page');
const { handleArtifactPageRequest } = await import('./serve-page-request');

/**
 * A teammate views a page through the view its author uploaded (design
 * 2026-09-24 §9 "Desktop contract"): main fetches it from the cloud and serves
 * it verbatim at its own `chord-artifact://` origin under the P1a isolation
 * headers. It has no authored assets and needs no host assets.
 */

const VIEW_HTML =
  '<!doctype html><html><head><style>/*tokens*/</style><script>/*bridge*/</script></head>' +
  '<body><div id="chord-root"></div><script>window.viewRan=1;</script></body></html>';

let root: string;
let runtimeDir: string;

function request(pageId: string, path: string): Request {
  return new Request(`chord-artifact://${pageId}${path}`);
}

function expectIsolationHeaders(response: Response, pageId: string): void {
  expect(response.headers.get('Content-Security-Policy')).toBe(artifactPageCsp(pageId));
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'chord-snapshot-source-'));
  runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  // Host assets exist on disk, so a 404 below proves the snapshot origin
  // refuses them rather than that the files happen to be missing.
  writeFileSync(join(runtimeDir, 'tokens.css'), ':root{}');
  writeFileSync(join(runtimeDir, 'chord-page.js'), '// bridge');
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(() => {
  clearPageSourcesForTest();
  clearPreparedBundlesForTest();
});

describe('registerSnapshotPageSource', () => {
  it('serves the uploaded view verbatim at / with the isolation headers', async () => {
    const source = registerSnapshotPageSource({
      artifactId: 'a-cloud',
      versionId: 'v-7',
      html: VIEW_HTML,
    });
    expect(source.kind).toBe('snapshot');
    expect(source.pageId).not.toBe('a-cloud');

    for (const path of ['/', '/index.html']) {
      const response = await handleArtifactPageRequest(request(source.pageId, path), runtimeDir);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      expectIsolationHeaders(response, source.pageId);
      expect(await response.text()).toBe(VIEW_HTML);
    }
  });

  it('serves nothing else at a snapshot origin — no authored assets, no host assets', async () => {
    const source = registerSnapshotPageSource({
      artifactId: 'a-cloud',
      versionId: 'v-7',
      html: VIEW_HTML,
    });
    for (const path of ['/__chord/tokens.css', '/__chord/chord-page.js', '/assets/style.css']) {
      const response = await handleArtifactPageRequest(request(source.pageId, path), runtimeDir);
      expect(response.status).toBe(404);
      expectIsolationHeaders(response, source.pageId);
    }
  });

  it('gives one version one origin, and another version another', () => {
    const first = registerSnapshotPageSource({
      artifactId: 'a-cloud',
      versionId: 'v-7',
      html: VIEW_HTML,
    });
    const again = registerSnapshotPageSource({
      artifactId: 'a-cloud',
      versionId: 'v-7',
      html: VIEW_HTML,
    });
    const next = registerSnapshotPageSource({
      artifactId: 'a-cloud',
      versionId: 'v-8',
      html: VIEW_HTML,
    });
    expect(again.pageId).toBe(first.pageId);
    expect(next.pageId).not.toBe(first.pageId);
    // A hostname label is at most 63 characters.
    expect(first.pageId.length).toBeLessThanOrEqual(63);
  });

  it('prepares without a bundle and returns the themed frame URL', async () => {
    const source = registerSnapshotPageSource({
      artifactId: 'a-cloud',
      versionId: 'v-7',
      html: VIEW_HTML,
    });
    const url = new URL(await preparePage(source, 'chord-light'));
    expect(url.protocol).toBe('chord-artifact:');
    expect(url.hostname).toBe(source.pageId);
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get(PAGE_THEME_QUERY_PARAM)).toBe('chord-light');
  });
});

describe('readCloudArtifactView', () => {
  it('reads the latest view the server holds', async () => {
    const view = await readCloudArtifactView(
      new Response(
        JSON.stringify({
          version_id: 'v-7',
          version_number: 3,
          trigger: 'agent_milestone',
          author_name: 'ada@example.com',
          created_at: '2026-09-26T10:00:00.000Z',
          html: VIEW_HTML,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    expect(view).toEqual({
      versionId: 'v-7',
      versionNumber: 3,
      trigger: 'agent_milestone',
      authorName: 'ada@example.com',
      createdAt: '2026-09-26T10:00:00.000Z',
      html: VIEW_HTML,
    });
  });

  it('turns 404 no_view into ArtifactViewMissingError', async () => {
    await expect(
      readCloudArtifactView(
        new Response(JSON.stringify({ error: 'no_view' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    ).rejects.toBeInstanceOf(ArtifactViewMissingError);
  });

  it('does not mistake any other 404 or a server error for a missing view', async () => {
    const notFound = readCloudArtifactView(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    );
    await expect(notFound).rejects.toThrow(/404/);
    await expect(notFound).rejects.not.toBeInstanceOf(ArtifactViewMissingError);

    const failed = readCloudArtifactView(new Response('boom', { status: 500 }));
    await expect(failed).rejects.toThrow(/500/);
    await expect(failed).rejects.not.toBeInstanceOf(ArtifactViewMissingError);
  });

  it('refuses a 200 body that is not a view', async () => {
    await expect(
      readCloudArtifactView(new Response(JSON.stringify({ version_id: 'v-7' }), { status: 200 }))
    ).rejects.toThrow();
  });
});
