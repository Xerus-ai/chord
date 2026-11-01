import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The registry module reads artifact rows; real SQLite from the shipped
// migrations, the repo's standard substitution (serve-page-request.test.ts).
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { clearPageSourcesForTest, findPageSource, registerRepoFilePageSource } = await import(
  './page-source-registry'
);

/**
 * Preview for every format (design 2026-09-26 §3): a repo file that is no
 * artifact still previews as a page when it is one — .html, .tsx, .mdx —
 * served from its own origin, confined to its checkout.
 */
const checkout = join('/work', 'repo');

beforeEach(() => clearPageSourcesForTest());

describe('registerRepoFilePageSource', () => {
  it.each([
    ['site/index.html', 'html'],
    ['ui/Hero.tsx', 'prototype'],
    ['ui/Card.jsx', 'prototype'],
    ['docs/intro.mdx', 'mdx'],
  ] as const)('serves %s as a %s page from the checkout', (filePath, kind) => {
    const source = registerRepoFilePageSource({
      workItemId: 'w1',
      checkoutPath: checkout,
      filePath,
    });
    expect(source).toMatchObject({
      kind,
      filePath: join(checkout, filePath),
      workItemId: 'w1',
      allowedRoots: [checkout],
    });
    expect(findPageSource(source.pageId)).toBe(source);
  });

  it('keeps one origin per file', () => {
    const a = registerRepoFilePageSource({
      workItemId: 'w1',
      checkoutPath: checkout,
      filePath: 'a.html',
    });
    const b = registerRepoFilePageSource({
      workItemId: 'w1',
      checkoutPath: checkout,
      filePath: 'a.html',
    });
    const c = registerRepoFilePageSource({
      workItemId: 'w1',
      checkoutPath: checkout,
      filePath: 'b.html',
    });
    expect(a.pageId).toBe(b.pageId);
    expect(a.pageId).not.toBe(c.pageId);
  });

  it('refuses a file that is not a page, and one outside the checkout', () => {
    expect(() =>
      registerRepoFilePageSource({
        workItemId: 'w1',
        checkoutPath: checkout,
        filePath: 'src/main.ts',
      })
    ).toThrow(/not a page/);
    expect(() =>
      registerRepoFilePageSource({
        workItemId: 'w1',
        checkoutPath: checkout,
        filePath: '../x.html',
      })
    ).toThrow(/outside/);
  });
});
