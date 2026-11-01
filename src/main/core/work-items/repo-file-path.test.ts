import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { confineToCheckout, writeRepoFileAt } from './repo-file-path';

/**
 * Paths arrive from tabs and rendered agent output: every read, write and
 * preview of a repo file stays inside the worktree's checkout.
 */
let checkout: string;

beforeAll(() => {
  checkout = mkdtempSync(join(tmpdir(), 'chord-repo-file-'));
  mkdirSync(join(checkout, 'site'));
  writeFileSync(join(checkout, 'site', 'index.html'), '<h1>old</h1>');
});

afterAll(() => {
  removeDirSync(checkout);
});

describe('confineToCheckout', () => {
  it('resolves a repo-relative path inside the checkout', () => {
    expect(confineToCheckout(checkout, 'site/index.html')).toBe(
      join(checkout, 'site', 'index.html')
    );
  });

  it('refuses a path that climbs out, an absolute path elsewhere, and the checkout itself', () => {
    expect(confineToCheckout(checkout, '../outside.txt')).toBeNull();
    expect(confineToCheckout(checkout, 'site/../../outside.txt')).toBeNull();
    expect(confineToCheckout(checkout, join(tmpdir(), 'elsewhere.txt'))).toBeNull();
    expect(confineToCheckout(checkout, '.')).toBeNull();
  });
});

/** Edit mode's save (design 2026-09-26 §3): the owner rewrites a file that exists. */
describe('writeRepoFileAt', () => {
  it('writes the new contents over an existing file', async () => {
    const result = await writeRepoFileAt(checkout, 'site/index.html', '<h1>new</h1>');
    expect(result).toEqual({ success: true, data: undefined });
    expect(readFileSync(join(checkout, 'site', 'index.html'), 'utf-8')).toBe('<h1>new</h1>');
  });

  it('refuses a path outside the checkout', async () => {
    const result = await writeRepoFileAt(checkout, '../escape.txt', 'x');
    expect(result).toMatchObject({ success: false, error: { type: 'outside_repo' } });
  });

  it('never creates a file: Edit only saves one that exists', async () => {
    const result = await writeRepoFileAt(checkout, 'site/new.html', 'x');
    expect(result).toMatchObject({ success: false, error: { type: 'not_found' } });
  });
});
